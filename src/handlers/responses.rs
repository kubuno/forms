use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use kubuno_db::params;

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::response::*,
    state::AppState,
};

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit:  Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let limit  = q.limit.unwrap_or(50).min(500);
    let offset = q.offset.unwrap_or(0);

    let responses = state.db.fetch_all_as::<FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses
         WHERE form_id = $1
         ORDER BY submitted_at DESC
         LIMIT $2 OFFSET $3",
        params![form_id, limit, offset],
    )
    .await?;

    let total: i64 = state.db.fetch_scalar(
        &format!(
            "SELECT {} FROM forms.responses WHERE form_id = $1",
            state.db.backend().count_bigint("*")
        ),
        params![form_id],
    )
    .await?;

    Ok(Json(json!({ "responses": responses, "total": total })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, response_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let response = state.db.fetch_optional_as::<FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses WHERE id = $1 AND form_id = $2",
        params![response_id, form_id],
    )
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Réponse {response_id}")))?;

    let answers = state.db.fetch_all_as::<Answer>(
        "SELECT * FROM forms.answers WHERE response_id = $1",
        params![response_id],
    )
    .await?;

    Ok(Json(json!({ "response": response, "answers": answers })))
}

pub async fn delete_one(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, response_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    state.db.execute(
        "DELETE FROM forms.responses WHERE id = $1 AND form_id = $2",
        params![response_id, form_id],
    )
    .await?;
    // Recompute the cached count. `form_id` is bound twice ($1 and $2) because a
    // placeholder cannot be reused across the three engines.
    state.db.execute(
        "UPDATE forms.forms SET response_count = (
            SELECT COUNT(*) FROM forms.responses WHERE form_id = $1
         ) WHERE id = $2",
        params![form_id, form_id],
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_all(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    // The CTE `DELETE ... RETURNING` has no portable form; a plain DELETE reports
    // its own affected-row count, which is exactly what was wanted.
    let deleted = state.db.execute(
        "DELETE FROM forms.responses WHERE form_id = $1",
        params![form_id],
    )
    .await?;

    state.db.execute(
        "UPDATE forms.forms SET response_count = 0, last_response_at = NULL WHERE id = $1",
        params![form_id],
    )
    .await?;

    Ok(Json(json!({ "deleted": deleted })))
}

pub async fn get_individual(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, index)): Path<(Uuid, i64)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let response_id: Option<Uuid> = state.db.fetch_optional_scalar(
        "SELECT id FROM forms.responses WHERE form_id = $1
         ORDER BY submitted_at DESC LIMIT 1 OFFSET $2",
        params![form_id, index],
    )
    .await?;

    let Some(rid) = response_id else {
        return Err(FormsError::NotFound("Réponse introuvable".into()));
    };

    let response = state.db.fetch_one_as::<FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses WHERE id = $1",
        params![rid],
    )
    .await?;

    let answers = state.db.fetch_all_as::<Answer>(
        "SELECT * FROM forms.answers WHERE response_id = $1",
        params![rid],
    )
    .await?;

    Ok(Json(json!({ "response": response, "answers": answers, "index": index })))
}
