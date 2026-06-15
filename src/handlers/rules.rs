use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::logic::*,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let rules = sqlx::query_as::<_, ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "rules": rules })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Json(body): Json<CreateRuleDto>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let max_pos: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(position) FROM forms.conditional_rules WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    let position = max_pos.unwrap_or(-1) + 1;
    let compare_str = body.compare_value.as_ref().map(|v| v.to_string());

    let rule = sqlx::query_as::<_, ConditionalRule>(
        "INSERT INTO forms.conditional_rules
            (form_id, position, trigger_question_id, operator, compare_value, action, target_section_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *",
    )
    .bind(form_id)
    .bind(position)
    .bind(body.trigger_question_id)
    .bind(&body.operator)
    .bind(compare_str.as_deref())
    .bind(&body.action)
    .bind(body.target_section_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "rule": rule })))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, rule_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRuleDto>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let rule = load_rule(&state, rule_id, form_id).await?;

    let operator = body.operator.unwrap_or(rule.operator);
    let action   = body.action.unwrap_or(rule.action);
    let compare_str = body.compare_value.as_ref()
        .map(|v| v.to_string())
        .or_else(|| rule.compare_value.as_ref().map(|v| v.to_string()));

    let target_section_id = if let Some(v) = body.target_section_id {
        v.as_str()
            .and_then(|s| Uuid::parse_str(s).ok())
            .or(rule.target_section_id)
    } else {
        rule.target_section_id
    };

    let updated = sqlx::query_as::<_, ConditionalRule>(
        "UPDATE forms.conditional_rules
         SET operator = $1, compare_value = $2::jsonb, action = $3, target_section_id = $4
         WHERE id = $5 RETURNING *",
    )
    .bind(&operator)
    .bind(compare_str.as_deref())
    .bind(&action)
    .bind(target_section_id)
    .bind(rule_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "rule": updated })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, rule_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    load_rule(&state, rule_id, form_id).await?;
    sqlx::query("DELETE FROM forms.conditional_rules WHERE id = $1")
        .bind(rule_id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn load_rule(state: &AppState, id: Uuid, form_id: Uuid) -> Result<ConditionalRule> {
    sqlx::query_as::<_, ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE id = $1 AND form_id = $2",
    )
    .bind(id)
    .bind(form_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Règle {id}")))
}
