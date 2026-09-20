use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use kubuno_db::{new_id, params};

use crate::{
    errors::{FormsError, Result},
    middleware::FormsUser,
    models::form::*,
    services::repo,
    state::AppState,
};

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub trashed: bool,
    pub limit:   Option<i64>,
    pub offset:  Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>> {
    let limit  = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let rows = state.db.fetch_all_as::<FormSummary>(
        "SELECT id, owner_id, title, description, theme, response_count, last_response_at,
                is_trashed, published_at, created_at, updated_at
         FROM forms.forms
         WHERE owner_id = $1 AND is_trashed = $2
         ORDER BY updated_at DESC
         LIMIT $3 OFFSET $4",
        params![user.id, q.trashed, limit, offset],
    )
    .await?;

    Ok(Json(json!({ "forms": rows })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Json(body): Json<CreateFormDto>,
) -> Result<Json<Value>> {
    let title = body.title.unwrap_or_else(|| "Formulaire sans titre".to_string());

    let form = repo::create_form(&state.db, user.id, &title).await?;

    Ok(Json(json!({ "form": form })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, id, user.id).await?;

    let questions = state.db.fetch_all_as::<Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
        params![id],
    )
    .await?;

    Ok(Json(json!({ "form": form, "questions": questions })))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateFormDto>,
) -> Result<Json<Value>> {
    let mut form = load_owned_form(&state, id, user.id).await?;

    // Rich text in, sanitised at the door (see crate::richtext).
    if let Some(t) = body.title {
        if !t.is_empty() {
            form.title = crate::richtext::clean_required(&t, &form.title);
        }
    }
    if let Some(d) = body.description {
        form.description = d.as_str().and_then(crate::richtext::clean);
    }
    if let Some(th) = body.theme {
        form.theme = th;
    }
    if let Some(s) = body.settings {
        form.settings = s;
    }

    let updated = repo::update_form_content(
        &state.db,
        id,
        &form.title,
        form.description.as_deref(),
        &form.theme,
        &form.settings,
    )
    .await?;

    Ok(Json(json!({ "form": updated })))
}

pub async fn trash(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    // NOW() and the boolean literal are bound from Rust: the three engines spell
    // them differently.
    state.db.execute(
        "UPDATE forms.forms SET is_trashed = $1, trashed_at = $2 WHERE id = $3",
        params![true, chrono::Utc::now(), id],
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn restore(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    state.db.execute(
        "UPDATE forms.forms SET is_trashed = $1, trashed_at = NULL WHERE id = $2",
        params![false, id],
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, id, user.id).await?;
    if !form.is_trashed {
        return Err(FormsError::Conflict(
            "Mettez d'abord le formulaire à la corbeille".into(),
        ));
    }
    state.db.execute("DELETE FROM forms.forms WHERE id = $1", params![id]).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn duplicate(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let original = load_owned_form(&state, id, user.id).await?;

    let new_title = format!("Copie de {}", original.title);
    // A copied form keeps the source's content but gets a fresh key (generated
    // here, so it can be re-selected without RETURNING) and a fresh public token
    // (the column default). `INSERT ... SELECT` copies exactly one row.
    let new_id_form = new_id();
    state.db.execute(
        "INSERT INTO forms.forms (id, owner_id, title, description, theme, settings)
         SELECT $1, $2, $3, description, theme, settings
         FROM forms.forms WHERE id = $4",
        params![new_id_form, user.id, &new_title, id],
    )
    .await?;
    let new_form = repo::load_form(&state.db, new_id_form)
        .await?
        .ok_or_else(|| FormsError::NotFound(format!("Formulaire {new_id_form}")))?;

    // Copy questions one by one: each copy needs its own key, so a single
    // multi-row `INSERT ... SELECT` (which cannot invent N keys in Rust) is
    // replaced by a per-row insert.
    let sources = state.db.fetch_all_as::<Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
        params![id],
    )
    .await?;
    for q in &sources {
        state.db.execute(
            "INSERT INTO forms.questions
                (id, form_id, position, question_type, title, description, required, options,
                 points, correct_answers, feedback_correct, feedback_incorrect)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
            params![
                new_id(),
                new_form.id,
                q.position,
                &q.question_type,
                &q.title,
                q.description.as_deref(),
                q.required,
                q.options.clone(),
                q.points,
                q.correct_answers.clone(),
                q.feedback_correct.as_deref(),
                q.feedback_incorrect.as_deref()
            ],
        )
        .await?;
    }

    Ok(Json(json!({ "form": new_form })))
}

/// `POST /forms/forms/:id/rotate-token` — issues a fresh public link.
///
/// Revoking a link is the only way to cut off people who already have it: the
/// old token stops resolving the moment a new one is stored. Answers already
/// collected are untouched.
pub async fn rotate_token(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    // The new token is generated in Rust (two dashless UUIDs = 64 hex chars) and
    // bound, so no engine-specific `gen_random_uuid()` and no RETURNING is
    // needed — the caller already holds the value it just stored.
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    state.db.execute(
        "UPDATE forms.forms SET public_token = $1 WHERE id = $2",
        params![&token, id],
    )
    .await?;
    Ok(Json(json!({ "public_token": token })))
}

pub async fn publish(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    let publish = body.get("publish").and_then(|v| v.as_bool()).unwrap_or(true);
    if publish {
        state.db.execute(
            "UPDATE forms.forms SET published_at = $1 WHERE id = $2 AND published_at IS NULL",
            params![chrono::Utc::now(), id],
        )
        .await?;
    } else {
        state.db.execute(
            "UPDATE forms.forms SET published_at = NULL WHERE id = $1",
            params![id],
        )
        .await?;
    }
    Ok(Json(json!({ "published": publish })))
}

// Helper: load a form and verify ownership
pub async fn load_owned_form(state: &AppState, id: Uuid, owner_id: Uuid) -> Result<Form> {
    let form = repo::load_form(&state.db, id)
        .await?
        .ok_or_else(|| FormsError::NotFound(format!("Formulaire {id}")))?;

    if form.owner_id != owner_id {
        return Err(FormsError::Forbidden);
    }
    Ok(form)
}
