//! User-to-user sharing of a form.
//!
//! The owner grants `view`/`edit` access to other Kubuno users. This module
//! owns the collaborator list and the recipient search (`core.users`); the
//! read/write ACL itself is enforced by the form handlers.
//! Mirrors office's document sharing so both behave the same way.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    middleware::FormsUser,
    state::AppState,
};

const PERMISSIONS: [&str; 2] = ["view", "edit"];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecipientHit {
    pub id:           Uuid,
    pub display_name: Option<String>,
    pub email:        String,
    pub avatar_url:   Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Collaborator {
    pub user_id:      Uuid,
    pub permission:   String,
    pub display_name: Option<String>,
    pub email:        String,
    pub avatar_url:   Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddCollaboratorDto {
    pub user_id:    Uuid,
    pub permission: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCollaboratorDto {
    pub permission: String,
}

/// True when `user` owns the form.
async fn is_owner(state: &AppState, form_id: Uuid, user_id: Uuid) -> Result<bool> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forms.forms WHERE id = $1 AND owner_id = $2)",
    )
    .bind(form_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    Ok(exists)
}

/// `GET /forms/recipients?q=` — users this form can be shared with.
pub async fn search_recipients(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Value>> {
    let query = q.q.unwrap_or_default();
    let query = query.trim();
    if query.is_empty() {
        return Ok(Json(json!({ "recipients": [] })));
    }
    let pattern = format!("%{query}%");
    let hits = sqlx::query_as::<_, RecipientHit>(
        r#"SELECT id, display_name, email::text AS email, avatar_url
           FROM core.users
           WHERE is_active = TRUE
             AND id <> $1
             AND (email::text ILIKE $2 OR username ILIKE $2 OR display_name ILIKE $2)
           ORDER BY display_name NULLS LAST, email
           LIMIT 20"#,
    )
    .bind(user.id)
    .bind(&pattern)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "recipients": hits })))
}

/// `GET /forms/forms/:id/collaborators` — owner and collaborators.
pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    // Le demandeur doit avoir accès au formulaire (owner OU collaborateur).
    let has_access: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM forms.forms WHERE id = $1 AND owner_id = $2
               UNION
               SELECT 1 FROM forms.form_collaborators WHERE form_id = $1 AND user_id = $2
           )"#,
    )
    .bind(form_id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    if !has_access {
        return Err(FormsError::NotFound(format!("Formulaire {form_id}")));
    }

    // Propriétaire (pour l'affichage).
    let owner = sqlx::query_as::<_, RecipientHit>(
        r#"SELECT u.id, u.display_name, u.email::text AS email, u.avatar_url
           FROM forms.forms d JOIN core.users u ON u.id = d.owner_id
           WHERE d.id = $1"#,
    )
    .bind(form_id)
    .fetch_optional(&state.db)
    .await?;

    let collaborators = sqlx::query_as::<_, Collaborator>(
        r#"SELECT c.user_id, c.permission,
                  u.display_name, u.email::text AS email, u.avatar_url
           FROM forms.form_collaborators c
           JOIN core.users u ON u.id = c.user_id
           WHERE c.form_id = $1
           ORDER BY u.display_name NULLS LAST, u.email"#,
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "owner": owner, "collaborators": collaborators })))
}

/// `POST /forms/forms/:id/collaborators` — add or update a collaborator (owner only).
pub async fn add(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Json(dto): Json<AddCollaboratorDto>,
) -> Result<Json<Value>> {
    if !is_owner(&state, form_id, user.id).await? {
        return Err(FormsError::Forbidden);
    }
    let permission = dto.permission.unwrap_or_else(|| "edit".to_string());
    if !PERMISSIONS.contains(&permission.as_str()) {
        return Err(FormsError::Validation(format!("Permission invalide : {permission}")));
    }
    if dto.user_id == user.id {
        return Err(FormsError::Validation("Le propriétaire a déjà accès".into()));
    }
    // Le destinataire doit exister et être actif.
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM core.users WHERE id = $1 AND is_active = TRUE)",
    )
    .bind(dto.user_id)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(FormsError::NotFound("Utilisateur introuvable".into()));
    }

    sqlx::query(
        r#"INSERT INTO forms.form_collaborators (form_id, user_id, permission)
           VALUES ($1, $2, $3)
           ON CONFLICT (form_id, user_id) DO UPDATE SET permission = EXCLUDED.permission"#,
    )
    .bind(form_id)
    .bind(dto.user_id)
    .bind(&permission)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true, "user_id": dto.user_id, "permission": permission })))
}

/// `PATCH /forms/forms/:id/collaborators/:user_id` — change a permission (owner only).
pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, target_id)): Path<(Uuid, Uuid)>,
    Json(dto): Json<UpdateCollaboratorDto>,
) -> Result<Json<Value>> {
    if !is_owner(&state, form_id, user.id).await? {
        return Err(FormsError::Forbidden);
    }
    if !PERMISSIONS.contains(&dto.permission.as_str()) {
        return Err(FormsError::Validation(format!("Permission invalide : {}", dto.permission)));
    }
    let rows = sqlx::query(
        "UPDATE forms.form_collaborators SET permission = $3 WHERE form_id = $1 AND user_id = $2",
    )
    .bind(form_id)
    .bind(target_id)
    .bind(&dto.permission)
    .execute(&state.db)
    .await?
    .rows_affected();
    if rows == 0 {
        return Err(FormsError::NotFound("Collaborateur introuvable".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// `DELETE /forms/forms/:id/collaborators/:user_id` — remove a collaborator.
/// Allowed to the owner, or to the collaborator themselves (leaving the share).
pub async fn remove(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    if target_id != user.id && !is_owner(&state, form_id, user.id).await? {
        return Err(FormsError::Forbidden);
    }
    sqlx::query(
        "DELETE FROM forms.form_collaborators WHERE form_id = $1 AND user_id = $2",
    )
    .bind(form_id)
    .bind(target_id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}
