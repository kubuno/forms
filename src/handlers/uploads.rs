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
