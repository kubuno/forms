use axum::{
    extract::{ConnectInfo, Path, State},
    Json,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    models::{form::*, response::*},
    state::AppState,
};

/// Retourne le formulaire public (titre, description, questions, thème)
pub async fn get_form(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>> {
    let form = load_public_form(&state, &token).await?;
    check_accepting(&form)?;

    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(form.id)
    .fetch_all(&state.db)
    .await?;

    // Strip owner_id and private fields from the public response
    let public_form = json!({
        "id":           form.id,
        "title":        form.title,
        "description":  form.description,
        "theme":        form.theme,
        "header_image_path": form.header_image_path,
        "settings": {
            "collectEmail":        form.settings.get("collectEmail"),
            "showProgressBar":     form.settings.get("showProgressBar"),
            "confirmationMessage": form.settings.get("confirmationMessage"),
            "requireSignIn":       form.settings.get("requireSignIn"),
        },
        "questions": questions,
    });

    Ok(Json(json!({ "form": public_form })))
}

/// Retourne le statut du formulaire (ouvert, fermé, expiré, complet)
pub async fn status(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>> {
    let form = load_public_form(&state, &token).await?;

    let accepting = form.settings.get("acceptingResponses")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !accepting {
        return Ok(Json(json!({ "status": "closed" })));
    }

    if let Some(close_date) = form.settings.get("closeDate").and_then(|v| v.as_str()) {
        if let Ok(dt) = close_date.parse::<chrono::DateTime<chrono::Utc>>() {
            if chrono::Utc::now() > dt {
                return Ok(Json(json!({ "status": "expired" })));
            }
        }
    }

    if let Some(max) = form.settings.get("maxResponses").and_then(|v| v.as_i64()) {
        if form.response_count as i64 >= max {
            return Ok(Json(json!({ "status": "full" })));
        }
    }

    Ok(Json(json!({ "status": "open", "response_count": form.response_count })))
}

/// Soumission publique du formulaire
pub async fn submit(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<SubmitFormDto>,
) -> Result<Json<Value>> {
    let form = load_public_form(&state, &token).await?;
    check_accepting(&form)?;

    // Anti-spam : délai entre soumissions de la même IP
    let cooldown = state.settings.forms.submission_cooldown_secs as i64;
    if cooldown > 0 {
        let ip = addr.ip().to_string();
        let recent: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM forms.responses
             WHERE form_id = $1 AND ip_address = $2::inet
               AND submitted_at > NOW() - ($3 || ' seconds')::interval",
        )
        .bind(form.id)
        .bind(&ip)
        .bind(cooldown.to_string())
        .fetch_one(&state.db)
        .await?;

        if recent > 0 {
            return Err(FormsError::TooManyRequests);
        }
    }

    // Valider les questions requises
    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1
         AND question_type NOT IN ('image', 'video', 'section')
         ORDER BY position ASC",
    )
    .bind(form.id)
    .fetch_all(&state.db)
    .await?;

    let answered_ids: std::collections::HashSet<Uuid> =
        body.answers.iter().map(|a| a.question_id).collect();

    for q in &questions {
        if q.required && !answered_ids.contains(&q.id) {
            return Err(FormsError::Validation(format!(
                "Question requise sans réponse : {}",
                q.title
            )));
        }
    }

    // Insérer la réponse
    let ip_str = addr.ip().to_string();
    let response = sqlx::query_as::<_, FormResponse>(
        "INSERT INTO forms.responses
            (form_id, respondent_email, respondent_name, ip_address, fill_duration_secs, source)
         VALUES ($1, $2, $3, $4::inet, $5, 'web')
         RETURNING id, form_id, respondent_id, respondent_email, respondent_name,
                   fill_duration_secs, score, max_score, source, submitted_at",
    )
    .bind(form.id)
    .bind(body.respondent_email.as_deref())
    .bind(body.respondent_name.as_deref())
    .bind(&ip_str)
    .bind(body.fill_duration_secs)
    .fetch_one(&state.db)
    .await?;

    // Insérer les réponses aux questions
    for answer in &body.answers {
        let value_str = serde_json::to_string(&answer.value)
            .unwrap_or_else(|_| "null".to_string());
        sqlx::query(
            "INSERT INTO forms.answers (response_id, question_id, value)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (response_id, question_id) DO NOTHING",
        )
        .bind(response.id)
        .bind(answer.question_id)
        .bind(&value_str)
        .execute(&state.db)
        .await?;
    }

    // Webhook asynchrone
    {
        let webhook_url = form.settings.get("webhookUrl")
            .and_then(|v| v.as_str())
            .map(String::from);
        if let Some(url) = webhook_url.filter(|u| !u.is_empty()) {
            let payload = json!({
                "event":    "form.response_received",
                "form_id":  form.id,
                "form_title": form.title,
                "response_id": response.id,
                "submitted_at": response.submitted_at,
            });
            tokio::spawn(async move {
                reqwest::Client::new()
                    .post(&url)
                    .json(&payload)
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await
                    .ok();
            });
        }
    }

    let confirmation = form.settings.get("confirmationMessage")
        .and_then(|v| v.as_str())
        .unwrap_or("Votre réponse a bien été enregistrée.")
        .to_string();

    Ok(Json(json!({
        "ok":            true,
        "response_id":   response.id,
        "confirmation":  confirmation,
    })))
}

async fn load_public_form(state: &AppState, token: &str) -> Result<crate::models::form::Form> {
    sqlx::query_as::<_, crate::models::form::Form>(
        "SELECT * FROM forms.forms WHERE public_token = $1 AND is_trashed = FALSE",
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound("Formulaire introuvable".into()))
}

fn check_accepting(form: &crate::models::form::Form) -> Result<()> {
    let accepting = form.settings.get("acceptingResponses")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !accepting {
        return Err(FormsError::FormClosed);
    }
    if let Some(close_date) = form.settings.get("closeDate").and_then(|v| v.as_str()) {
        if let Ok(dt) = close_date.parse::<chrono::DateTime<chrono::Utc>>() {
            if chrono::Utc::now() > dt {
                return Err(FormsError::FormClosed);
            }
        }
    }
    if let Some(max) = form.settings.get("maxResponses").and_then(|v| v.as_i64()) {
        if form.response_count as i64 >= max {
            return Err(FormsError::Conflict("Nombre maximum de réponses atteint".into()));
        }
    }
    Ok(())
}
