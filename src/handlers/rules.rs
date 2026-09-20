use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use kubuno_db::dialect::SqlType;
use kubuno_db::{new_id, params};

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
    let rules = state.db.fetch_all_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE form_id = $1 ORDER BY position ASC",
        params![form_id],
    )
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

    // MAX(position) is NULL on an empty form; cast so it decodes as i64 on the
    // three engines and read it as an `Option`.
    let max_expr = state.db.backend().cast("MAX(position)", SqlType::BigInt);
    let max_pos: Option<i64> = state.db.fetch_scalar(
        &format!("SELECT {max_expr} FROM forms.conditional_rules WHERE form_id = $1"),
        params![form_id],
    )
    .await?;

    let position = (max_pos.unwrap_or(-1) + 1) as i32;

    // compare_value is bound as JSON directly (no `::jsonb` cast, which only
    // PostgreSQL understands). The row is re-selected after the keyed insert.
    let id = new_id();
    state.db.execute(
        "INSERT INTO forms.conditional_rules
            (id, form_id, position, trigger_question_id, operator, compare_value, action, target_section_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        params![
            id,
            form_id,
            position,
            body.trigger_question_id,
            &body.operator,
            body.compare_value.clone(),
            &body.action,
            body.target_section_id
        ],
    )
    .await?;
    let rule = state.db.fetch_one_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE id = $1",
        params![id],
    )
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
    // A new value replaces the stored one; otherwise the stored one is kept.
    let compare_value = body.compare_value.clone().or(rule.compare_value);

    let target_section_id = if let Some(v) = body.target_section_id {
        v.as_str()
            .and_then(|s| Uuid::parse_str(s).ok())
            .or(rule.target_section_id)
    } else {
        rule.target_section_id
    };

    state.db.execute(
        "UPDATE forms.conditional_rules
         SET operator = $1, compare_value = $2, action = $3, target_section_id = $4
         WHERE id = $5",
        params![&operator, compare_value, &action, target_section_id, rule_id],
    )
    .await?;
    let updated = state.db.fetch_one_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE id = $1",
        params![rule_id],
    )
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
    state.db.execute("DELETE FROM forms.conditional_rules WHERE id = $1", params![rule_id]).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn load_rule(state: &AppState, id: Uuid, form_id: Uuid) -> Result<ConditionalRule> {
    state.db.fetch_optional_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE id = $1 AND form_id = $2",
        params![id, form_id],
    )
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Règle {id}")))
}
