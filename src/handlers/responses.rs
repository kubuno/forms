use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

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

    let responses = sqlx::query_as::<_, FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses
         WHERE form_id = $1
         ORDER BY submitted_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(form_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM forms.responses WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "responses": responses, "total": total })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, response_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let response = sqlx::query_as::<_, FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses WHERE id = $1 AND form_id = $2",
    )
    .bind(response_id)
    .bind(form_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Réponse {response_id}")))?;

    let answers = sqlx::query_as::<_, Answer>(
        "SELECT * FROM forms.answers WHERE response_id = $1",
    )
    .bind(response_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "response": response, "answers": answers })))
}

pub async fn delete_one(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, response_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    sqlx::query("DELETE FROM forms.responses WHERE id = $1 AND form_id = $2")
        .bind(response_id)
        .bind(form_id)
        .execute(&state.db)
        .await?;
    // Update count
    sqlx::query(
        "UPDATE forms.forms SET response_count = (
            SELECT COUNT(*) FROM forms.responses WHERE form_id = $1
         ) WHERE id = $1",
    )
    .bind(form_id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_all(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let deleted: i64 = sqlx::query_scalar(
        "WITH del AS (DELETE FROM forms.responses WHERE form_id = $1 RETURNING id)
         SELECT COUNT(*) FROM del",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "UPDATE forms.forms SET response_count = 0, last_response_at = NULL WHERE id = $1",
    )
    .bind(form_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "deleted": deleted })))
}

pub async fn get_individual(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, index)): Path<(Uuid, i64)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let response_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM forms.responses WHERE form_id = $1
         ORDER BY submitted_at DESC LIMIT 1 OFFSET $2",
    )
    .bind(form_id)
    .bind(index)
    .fetch_optional(&state.db)
    .await?;

    let Some(rid) = response_id else {
        return Err(FormsError::NotFound("Réponse introuvable".into()));
    };

    let response = sqlx::query_as::<_, FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses WHERE id = $1",
    )
    .bind(rid)
    .fetch_one(&state.db)
    .await?;

    let answers = sqlx::query_as::<_, Answer>(
        "SELECT * FROM forms.answers WHERE response_id = $1",
    )
    .bind(rid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "response": response, "answers": answers, "index": index })))
}
