//! Response retention: a background purge of form responses older than the
//! instance retention window. Off (`0`) means keep responses forever.

use std::time::Duration;

use chrono::Utc;
use uuid::Uuid;

use kubuno_db::{params, DbValue};

use crate::state::AppState;

/// Background worker: hourly, deletes responses submitted longer ago than the
/// retention window, then recomputes the response count of the forms that lost
/// responses. Bounded per run so a large backlog drains gradually. The first
/// pass is deferred by one interval so a fresh deploy never purges on boot.
pub async fn run_retention_worker(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
        let days = state.instance().response_retention_days;
        if days <= 0 {
            continue;
        }

        // The cutoff is computed in Rust; the CTE `DELETE ... RETURNING` has no
        // portable form, so a bounded batch of victims is selected first, then
        // deleted by id. Answers and logic rows fall away through their
        // `ON DELETE CASCADE` on the response.
        let cutoff = Utc::now() - chrono::Duration::days(days);
        let victims: Vec<(Uuid, Uuid)> = state
            .db
            .fetch_all_as::<(Uuid, Uuid)>(
                "SELECT id, form_id FROM forms.responses WHERE submitted_at < $1 \
                 ORDER BY submitted_at LIMIT 1000",
                params![cutoff],
            )
            .await
            .unwrap_or_default();

        if victims.is_empty() {
            continue;
        }

        let ids: Vec<Uuid> = victims.iter().map(|(id, _)| *id).collect();
        let mut affected: Vec<Uuid> = victims.iter().map(|(_, f)| *f).collect();
        affected.sort();
        affected.dedup();

        let in_list = state.db.backend().in_list(1, ids.len());
        let delete_params: Vec<DbValue> = ids.iter().map(|id| DbValue::from(*id)).collect();
        if let Err(e) = state
            .db
            .execute(
                &format!("DELETE FROM forms.responses WHERE id IN ({in_list})"),
                delete_params,
            )
            .await
        {
            tracing::error!(error = %e, "Purge de rétention : suppression impossible");
            continue;
        }

        for form_id in &affected {
            // `form_id` is bound twice ($1 and $2): a placeholder cannot be
            // reused across the three engines.
            if let Err(e) = state
                .db
                .execute(
                    "UPDATE forms.forms SET response_count = (
                        SELECT COUNT(*) FROM forms.responses WHERE form_id = $1
                     ) WHERE id = $2",
                    params![*form_id, *form_id],
                )
                .await
            {
                tracing::error!(error = %e, form_id = %form_id, "Purge de rétention : recomptage impossible");
            }
        }

        if !affected.is_empty() {
            tracing::info!(
                "Purge de rétention forms : réponses anciennes supprimées sur {} formulaire(s)",
                affected.len()
            );
        }
    }
}
