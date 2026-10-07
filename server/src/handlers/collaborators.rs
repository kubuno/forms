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

use kubuno_db::dialect::{Assign, SqlType};
use kubuno_db::params;

use crate::{
    errors::{FormsError, Result},
    middleware::FormsUser,
    state::AppState,
};

// NOTE ON `core.users`. The recipient search and the collaborator listing read
// the core's `core.users` table directly. This resolves only when the module
// shares one database with the core — PostgreSQL (all schemas in one database)
// and MySQL (the `core` database on the same server). On SQLite, where each
// module owns a separate attached file, `core.users` is not present and these
// two endpoints fail at run time. This is the same class of cross-component
// coupling kubuno-db documents for the event bus; it is not something the
// dialect layer can bridge.

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
    // `SELECT EXISTS(...)` has no portable decode; a `SELECT 1 ... LIMIT 1` that
    // is present-or-absent says the same thing.
    let found = state.db.fetch_optional_scalar::<i32>(
        "SELECT 1 FROM forms.forms WHERE id = $1 AND owner_id = $2 LIMIT 1",
        params![form_id, user_id],
    )
    .await?
    .is_some();
    Ok(found)
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
    let backend = state.db.backend();
    // The `$2` pattern is bound three times: a placeholder cannot be reused
    // across the three engines. `email::text` becomes a dialect cast, ILIKE a
    // dialect helper, and `NULLS LAST` an explicit `(col IS NULL)` sort key.
    let sql = format!(
        "SELECT id, display_name, {email} AS email, avatar_url
           FROM core.users
           WHERE is_active = TRUE
             AND id <> $1
             AND ({e} OR {u} OR {d})
           ORDER BY (display_name IS NULL), display_name, email
           LIMIT 20",
        email = backend.cast("email", SqlType::Text),
        e = backend.ilike("email", 2),
        u = backend.ilike("username", 3),
        d = backend.ilike("display_name", 4),
    );
    let hits = state.db.fetch_all_as::<RecipientHit>(
        &sql,
        params![user.id, &pattern, &pattern, &pattern],
    )
    .await?;
    Ok(Json(json!({ "recipients": hits })))
}

/// `GET /forms/forms/:id/collaborators` — owner and collaborators.
pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    // Le demandeur doit avoir accès au formulaire (owner OU collaborateur). The
    // two arms bind form_id/user_id under distinct placeholders ($1..$4): a
    // reused placeholder is refused on the non-PostgreSQL engines.
    let has_access = state.db.fetch_optional_scalar::<i32>(
        r#"SELECT 1 FROM forms.forms WHERE id = $1 AND owner_id = $2
           UNION
           SELECT 1 FROM forms.form_collaborators WHERE form_id = $3 AND user_id = $4
           LIMIT 1"#,
        params![form_id, user.id, form_id, user.id],
    )
    .await?
    .is_some();
    if !has_access {
        return Err(FormsError::NotFound(format!("Formulaire {form_id}")));
    }

    let backend = state.db.backend();
    let u_email = backend.cast("u.email", SqlType::Text);

    // Propriétaire (pour l'affichage).
    let owner = state.db.fetch_optional_as::<RecipientHit>(
        &format!(
            "SELECT u.id, u.display_name, {u_email} AS email, u.avatar_url
             FROM forms.forms d JOIN core.users u ON u.id = d.owner_id
             WHERE d.id = $1"
        ),
        params![form_id],
    )
    .await?;

    let collaborators = state.db.fetch_all_as::<Collaborator>(
        &format!(
            "SELECT c.user_id, c.permission,
                    u.display_name, {u_email} AS email, u.avatar_url
             FROM forms.form_collaborators c
             JOIN core.users u ON u.id = c.user_id
             WHERE c.form_id = $1
             ORDER BY (u.display_name IS NULL), u.display_name, u.email"
        ),
        params![form_id],
    )
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
    let exists = state.db.fetch_optional_scalar::<i32>(
        "SELECT 1 FROM core.users WHERE id = $1 AND is_active = TRUE LIMIT 1",
        params![dto.user_id],
    )
    .await?
    .is_some();
    if !exists {
        return Err(FormsError::NotFound("Utilisateur introuvable".into()));
    }

    // `ON CONFLICT ... DO UPDATE` becomes `ON DUPLICATE KEY UPDATE` on MySQL.
    let sql = format!(
        "INSERT INTO forms.form_collaborators (form_id, user_id, permission) VALUES ($1, $2, $3){}",
        state.db.backend().upsert(
            "form_collaborators",
            &["form_id", "user_id"],
            &[Assign::Incoming("permission")],
        ),
    );
    state.db.execute(&sql, params![form_id, dto.user_id, &permission]).await?;

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
    // Existence is checked first rather than inferred from rows_affected: MySQL
    // reports 0 affected rows for an UPDATE that changed nothing (e.g. setting
    // the permission it already had), which would look like "not found".
    let present = state.db.fetch_optional_scalar::<i32>(
        "SELECT 1 FROM forms.form_collaborators WHERE form_id = $1 AND user_id = $2 LIMIT 1",
        params![form_id, target_id],
    )
    .await?
    .is_some();
    if !present {
        return Err(FormsError::NotFound("Collaborateur introuvable".into()));
    }
    state.db.execute(
        "UPDATE forms.form_collaborators SET permission = $1 WHERE form_id = $2 AND user_id = $3",
        params![&dto.permission, form_id, target_id],
    )
    .await?;
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
    state.db.execute(
        "DELETE FROM forms.form_collaborators WHERE form_id = $1 AND user_id = $2",
        params![form_id, target_id],
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}
