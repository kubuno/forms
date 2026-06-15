use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    middleware::FormsUser,
    models::form::*,
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

    let rows = sqlx::query_as::<_, FormSummary>(
        "SELECT id, owner_id, title, description, theme, response_count, last_response_at,
                is_trashed, published_at, created_at, updated_at
         FROM forms.forms
         WHERE owner_id = $1 AND is_trashed = $2
         ORDER BY updated_at DESC
         LIMIT $3 OFFSET $4",
    )
    .bind(user.id)
    .bind(q.trashed)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "forms": rows })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Json(body): Json<CreateFormDto>,
) -> Result<Json<Value>> {
    let title = body.title.unwrap_or_else(|| "Formulaire sans titre".to_string());

    let form = sqlx::query_as::<_, Form>(
        "INSERT INTO forms.forms (owner_id, title)
         VALUES ($1, $2)
         RETURNING *",
    )
    .bind(user.id)
    .bind(&title)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "form": form })))
}

pub async fn get(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, id, user.id).await?;

    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(id)
    .fetch_all(&state.db)
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

    if let Some(t) = body.title {
        if !t.is_empty() {
            form.title = t;
        }
    }
    if let Some(d) = body.description {
        form.description = d.as_str().map(String::from);
    }
    if let Some(th) = body.theme {
        form.theme = th;
    }
    if let Some(s) = body.settings {
        form.settings = s;
    }

    let updated = sqlx::query_as::<_, Form>(
        "UPDATE forms.forms
         SET title = $1, description = $2, theme = $3, settings = $4
         WHERE id = $5
         RETURNING *",
    )
    .bind(&form.title)
    .bind(&form.description)
    .bind(&form.theme)
    .bind(&form.settings)
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "form": updated })))
}

pub async fn trash(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    sqlx::query(
        "UPDATE forms.forms SET is_trashed = TRUE, trashed_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn restore(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, id, user.id).await?;
    sqlx::query(
        "UPDATE forms.forms SET is_trashed = FALSE, trashed_at = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
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
    sqlx::query("DELETE FROM forms.forms WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn duplicate(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let original = load_owned_form(&state, id, user.id).await?;

    let new_title = format!("Copie de {}", original.title);
    let new_form = sqlx::query_as::<_, Form>(
        "INSERT INTO forms.forms (owner_id, title, description, theme, settings)
         SELECT $1, $2, description, theme, settings
         FROM forms.forms WHERE id = $3
         RETURNING *",
    )
    .bind(user.id)
    .bind(&new_title)
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    // Copy questions
    sqlx::query(
        "INSERT INTO forms.questions
            (form_id, position, question_type, title, description, required, options,
             points, correct_answers, feedback_correct, feedback_incorrect)
         SELECT $1, position, question_type, title, description, required, options,
                points, correct_answers, feedback_correct, feedback_incorrect
         FROM forms.questions WHERE form_id = $2 ORDER BY position ASC",
    )
    .bind(new_form.id)
    .bind(id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "form": new_form })))
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
        sqlx::query(
            "UPDATE forms.forms SET published_at = NOW() WHERE id = $1 AND published_at IS NULL",
        )
        .bind(id)
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query("UPDATE forms.forms SET published_at = NULL WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await?;
    }
    Ok(Json(json!({ "published": publish })))
}

// Helper: load a form and verify ownership
pub async fn load_owned_form(state: &AppState, id: Uuid, owner_id: Uuid) -> Result<Form> {
    let form = sqlx::query_as::<_, Form>("SELECT * FROM forms.forms WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| FormsError::NotFound(format!("Formulaire {id}")))?;

    if form.owner_id != owner_id {
        return Err(FormsError::Forbidden);
    }
    Ok(form)
}
