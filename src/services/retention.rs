//! Response retention: a background purge of form responses older than the
//! instance retention window. Off (`0`) means keep responses forever.

use std::time::Duration;

use uuid::Uuid;

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

        // Delete a bounded batch and learn which forms were affected. Answers and
        // logic rows fall away through their `ON DELETE CASCADE` on the response.
        let affected: Vec<Uuid> = sqlx::query_scalar(
            "WITH del AS (
                DELETE FROM forms.responses
                WHERE id IN (
                    SELECT id FROM forms.responses
                    WHERE submitted_at < NOW() - make_interval(days => $1)
                    LIMIT 1000
                )
                RETURNING form_id
             )
             SELECT DISTINCT form_id FROM del",
        )
        .bind(days as i32)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        for form_id in &affected {
            if let Err(e) = sqlx::query(
                "UPDATE forms.forms SET response_count = (
                    SELECT COUNT(*) FROM forms.responses WHERE form_id = $1
                 ) WHERE id = $1",
            )
            .bind(form_id)
            .execute(&state.db)
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
