use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    state::AppState,
};

#[derive(sqlx::FromRow)]
struct Upload {
    file_name:    String,
    content_type: Option<String>,
    storage_path: String,
}

/// Public file upload tied to a form (one file per request, field name "file").
/// Returns a file descriptor that the respondent stores as the answer value.
pub async fn upload(
    State(state): State<AppState>,
    Path(token): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let form = sqlx::query_as::<_, crate::models::form::Form>(
        "SELECT * FROM forms.forms WHERE public_token = $1 AND is_trashed = FALSE",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound("Formulaire introuvable".into()))?;

    let max_bytes = state.settings.forms.max_file_upload_mb * 1024 * 1024;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| FormsError::Validation(format!("Champ multipart invalide : {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let orig_name = field
            .file_name()
            .map(sanitize_name)
            .unwrap_or_else(|| "fichier".to_string());
        let content_type = field.content_type().map(String::from);
        let question_id = None::<Uuid>; // optional association; kept simple for now

        let data = field
            .bytes()
            .await
            .map_err(|e| FormsError::Validation(format!("Lecture du fichier impossible : {e}")))?;

        if data.len() as u64 > max_bytes {
            return Err(FormsError::Validation(format!(
                "Fichier trop volumineux (max {} Mo)",
                state.settings.forms.max_file_upload_mb
            )));
        }

        let file_id = Uuid::new_v4();
        let ext = std::path::Path::new(&orig_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();

        let dir = std::path::Path::new(&state.settings.storage.local_path).join(form.id.to_string());
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;
        let stored = format!("{file_id}{ext}");
        let full_path = dir.join(&stored);
        tokio::fs::write(&full_path, &data)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;

        let storage_path = full_path.to_string_lossy().to_string();
        sqlx::query(
            "INSERT INTO forms.uploads
                (id, form_id, question_id, file_name, content_type, size_bytes, storage_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(file_id)
        .bind(form.id)
        .bind(question_id)
        .bind(&orig_name)
        .bind(&content_type)
        .bind(data.len() as i64)
        .bind(&storage_path)
        .execute(&state.db)
        .await?;

        return Ok(Json(json!({
            "fileId":      file_id,
            "name":        orig_name,
            "size":        data.len(),
            "contentType": content_type,
        })));
    }

    Err(FormsError::Validation("Aucun fichier reçu".into()))
}

/// Owner-only download of a file uploaded through a form submission.
pub async fn download(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Response> {
    load_owned_form(&state, form_id, user.id).await?;

    let upload = sqlx::query_as::<_, Upload>(
        "SELECT id, form_id, file_name, content_type, storage_path
         FROM forms.uploads WHERE id = $1 AND form_id = $2",
    )
    .bind(file_id)
    .bind(form_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound("Fichier introuvable".into()))?;

    let bytes = tokio::fs::read(&upload.storage_path)
        .await
        .map_err(|_| FormsError::NotFound("Fichier absent du stockage".into()))?;

    let ct = upload.content_type.unwrap_or_else(|| "application/octet-stream".to_string());
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", upload.file_name),
        )
        .body(Body::from(bytes))
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))
}

/// Keep only the file's base name and strip characters that could escape the dir.
fn sanitize_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "fichier".to_string() } else { trimmed.to_string() }
}

// ── Form header image ─────────────────────────────────────────────────────────
// The banner shown at the top of the form (editor and public page). Stored on
// disk next to the form's answer uploads; the path is kept on the form row so a
// form has at most one header at a time.

/// Replace the form's header image (multipart, field name "file"). Owner only.
pub async fn upload_header(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, form_id, user.id).await?;
    let max_bytes = state.settings.forms.max_file_upload_mb * 1024 * 1024;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| FormsError::Validation(format!("Champ multipart invalide : {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let orig_name = field.file_name().map(sanitize_name).unwrap_or_else(|| "entete".to_string());
        let content_type = field.content_type().map(String::from);
        if !content_type.as_deref().unwrap_or_default().starts_with("image/") {
            return Err(FormsError::Validation("Le fichier doit être une image".into()));
        }
        let data = field
            .bytes()
            .await
            .map_err(|e| FormsError::Validation(format!("Lecture du fichier impossible : {e}")))?;
        if data.len() as u64 > max_bytes {
            return Err(FormsError::Validation(format!(
                "Image trop volumineuse (max {} Mo)",
                state.settings.forms.max_file_upload_mb
            )));
        }

        let ext = std::path::Path::new(&orig_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_else(|| ".img".to_string());
        let dir = std::path::Path::new(&state.settings.storage.local_path).join(form.id.to_string());
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;
        // A fresh name per upload: the browser would otherwise serve the old
        // banner from cache after a replacement.
        let full_path = dir.join(format!("header-{}{ext}", Uuid::new_v4()));
        tokio::fs::write(&full_path, &data)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;

        let previous = form.header_image_path.clone();
        let stored = full_path.to_string_lossy().to_string();
        if let Err(e) = sqlx::query("UPDATE forms.forms SET header_image_path = $1, updated_at = NOW() WHERE id = $2")
            .bind(&stored)
            .bind(form.id)
            .execute(&state.db)
            .await
        {
            tracing::error!(form_id = %form.id, error = %e, "MAJ de l'image d'en-tête échouée");
            return Err(e.into());
        }
        // Best effort: drop the file the form no longer points at.
        if let Some(old) = previous {
            let _ = tokio::fs::remove_file(&old).await;
        }

        return Ok(Json(json!({ "headerImagePath": stored })));
    }

    Err(FormsError::Validation("Aucun fichier reçu".into()))
}

/// Remove the form's header image. Owner only.
pub async fn delete_header(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<StatusCode> {
    let form = load_owned_form(&state, form_id, user.id).await?;
    if let Err(e) = sqlx::query("UPDATE forms.forms SET header_image_path = NULL, updated_at = NOW() WHERE id = $1")
        .bind(form.id)
        .execute(&state.db)
        .await
    {
        tracing::error!(form_id = %form.id, error = %e, "Suppression de l'image d'en-tête échouée");
        return Err(e.into());
    }
    if let Some(old) = form.header_image_path {
        let _ = tokio::fs::remove_file(&old).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Serve the header image of a form. Public: the banner is part of the public
/// form, so it is addressed by the form's public token, never by its id.
pub async fn header_image(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response> {
    let form = sqlx::query_as::<_, crate::models::form::Form>(
        "SELECT * FROM forms.forms WHERE public_token = $1 AND is_trashed = FALSE",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound("Formulaire introuvable".into()))?;

    let path = form
        .header_image_path
        .ok_or_else(|| FormsError::NotFound("Aucune image d'en-tête".into()))?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| FormsError::NotFound("Image absente du stockage".into()))?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, guess_image_type(&path))
        .header(header::CACHE_CONTROL, "private, max-age=60")
        .body(Body::from(bytes))
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))
}

fn guess_image_type(path: &str) -> &'static str {
    match std::path::Path::new(path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png")  => "image/png",
        Some("gif")  => "image/gif",
        Some("webp") => "image/webp",
        Some("svg")  => "image/svg+xml",
        _             => "image/jpeg",
    }
}

// ── Form images (option illustrations, content blocks) ────────────────────────
// A form is filled by ANONYMOUS respondents, so an image shown inside it cannot
// live behind an authenticated URL (Drive or Media would answer 401 to them).
// Owners therefore upload into the form's own storage, and the file is served
// through the form's PUBLIC token.

/// Upload an image belonging to a form (multipart, field "file"). Owner only.
pub async fn upload_image(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, form_id, user.id).await?;
    let max_bytes = state.settings.forms.max_file_upload_mb * 1024 * 1024;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| FormsError::Validation(format!("Champ multipart invalide : {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let orig = field.file_name().map(sanitize_name).unwrap_or_else(|| "image".to_string());
        let content_type = field.content_type().map(String::from);
        if !content_type.as_deref().unwrap_or_default().starts_with("image/") {
            return Err(FormsError::Validation("Le fichier doit être une image".into()));
        }
        let data = field
            .bytes()
            .await
            .map_err(|e| FormsError::Validation(format!("Lecture du fichier impossible : {e}")))?;
        if data.len() as u64 > max_bytes {
            return Err(FormsError::Validation(format!(
                "Image trop volumineuse (max {} Mo)",
                state.settings.forms.max_file_upload_mb
            )));
        }

        let ext = std::path::Path::new(&orig)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_else(|| ".img".to_string());
        let name = format!("img-{}{ext}", Uuid::new_v4());
        let dir = std::path::Path::new(&state.settings.storage.local_path).join(form.id.to_string());
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;
        tokio::fs::write(dir.join(&name), &data)
            .await
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))?;

        // The URL the editor stores: readable by anonymous respondents.
        let url = format!("/api/v1/forms/public/{}/image/{}", form.public_token, name);
        return Ok(Json(json!({ "url": url, "name": name })));
    }

    Err(FormsError::Validation("Aucun fichier reçu".into()))
}

/// Serve a form image by public token. Public: it is part of the public form.
pub async fn form_image(
    State(state): State<AppState>,
    Path((token, name)): Path<(String, String)>,
) -> Result<Response> {
    // Names are generated server-side; refuse anything that could climb out of
    // the form's own directory.
    if name.contains('/') || name.contains('\\') || name.contains("..") || !name.starts_with("img-") {
        return Err(FormsError::NotFound("Image introuvable".into()));
    }

    let form_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM forms.forms WHERE public_token = $1 AND is_trashed = FALSE",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound("Formulaire introuvable".into()))?;

    let path = std::path::Path::new(&state.settings.storage.local_path)
        .join(form_id.to_string())
        .join(&name);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| FormsError::NotFound("Image absente du stockage".into()))?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, guess_image_type(&name))
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(bytes))
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e)))
}
