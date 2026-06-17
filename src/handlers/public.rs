use axum::{
    extract::{ConnectInfo, Path, State},
    Json,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    models::{form::*, logic::ConditionalRule, response::*},
    services::scoring,
    state::AppState,
};

/// Content-only types that never collect an answer and are skipped for validation.
const NON_INPUT_TYPES: &[&str] = &[
    "image", "video", "section", "statement", "welcome_screen", "thank_you_screen",
];

/// Returns the public view of a form (title, description, questions, theme, logic).
/// Sensitive quiz data (correct answers, points, feedback) is never exposed here.
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

    // Strip correct_answers / points / feedback so quizzes cannot be cheated.
    let public_questions: Vec<Value> = questions
        .iter()
        .map(|q| {
            json!({
                "id":            q.id,
                "position":      q.position,
                "question_type": q.question_type,
                "title":         q.title,
                "description":   q.description,
                "required":      q.required,
                "image_path":    q.image_path,
                "options":       q.options,
            })
        })
        .collect();

    let rules = sqlx::query_as::<_, ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(form.id)
    .fetch_all(&state.db)
    .await?;

    let s = &form.settings;
    let public_form = json!({
        "id":           form.id,
        "title":        form.title,
        "description":  form.description,
        "theme":        form.theme,
        "header_image_path": form.header_image_path,
        "settings": {
            "collectEmail":         s.get("collectEmail"),
            "showProgressBar":      s.get("showProgressBar"),
            "confirmationMessage":  s.get("confirmationMessage"),
            "requireSignIn":        s.get("requireSignIn"),
            "displayMode":          s.get("displayMode"),
            "quizMode":             s.get("quizMode"),
            "showResultImmediately": s.get("showResultImmediately"),
            "shuffleQuestions":     s.get("shuffleQuestions"),
        },
        "questions": public_questions,
        "rules":     rules,
    });

    Ok(Json(json!({ "form": public_form })))
}

/// Returns the status of a form (open, closed, expired, full).
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

/// Public form submission (anonymous respondent).
pub async fn submit(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<SubmitFormDto>,
) -> Result<Json<Value>> {
    let form = load_public_form(&state, &token).await?;
    check_accepting(&form)?;

    // Anti-spam: cooldown between submissions from the same IP.
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

    // Load all questions (with scoring data, used server-side only).
    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(form.id)
    .fetch_all(&state.db)
    .await?;

    // Validate required questions (skip content-only types). When the form uses
    // conditional logic, required questions can be legitimately hidden client-side,
    // so we trust the client's validation rather than risk false rejections.
    let rule_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM forms.conditional_rules WHERE form_id = $1",
    )
    .bind(form.id)
    .fetch_one(&state.db)
    .await?;

    if rule_count == 0 {
        let answered_ids: std::collections::HashSet<Uuid> = body
            .answers
            .iter()
            .filter(|a| !a.value.is_null() && !is_blank(&a.value))
            .map(|a| a.question_id)
            .collect();

        for q in &questions {
            if q.required
                && !NON_INPUT_TYPES.contains(&q.question_type.as_str())
                && !answered_ids.contains(&q.id)
            {
                return Err(FormsError::Validation(format!(
                    "Question requise sans réponse : {}",
                    q.title
                )));
            }
        }
    }

    // ── Quiz scoring ────────────────────────────────────────────────────────
    let max_score: i32 = questions.iter().filter(|q| scoring::is_scorable(q)).map(|q| q.points).sum();
    let has_quiz = max_score > 0;

    let question_by_id: std::collections::HashMap<Uuid, &Question> =
        questions.iter().map(|q| (q.id, q)).collect();

    let mut total_score = 0i32;
    // Per-answer grading, keyed by question id.
    let mut graded: std::collections::HashMap<Uuid, (bool, i32)> = std::collections::HashMap::new();
    for answer in &body.answers {
        if let Some(q) = question_by_id.get(&answer.question_id) {
            if scoring::is_scorable(q) {
                let g = scoring::grade(q, &answer.value);
                total_score += g.points_earned;
                graded.insert(answer.question_id, (g.is_correct, g.points_earned));
            }
        }
    }

    // Insert the response (with score when this is a quiz).
    let ip_str = addr.ip().to_string();
    let response = sqlx::query_as::<_, FormResponse>(
        "INSERT INTO forms.responses
            (form_id, respondent_email, respondent_name, ip_address, fill_duration_secs,
             score, max_score, source)
         VALUES ($1, $2, $3, $4::inet, $5, $6, $7, 'web')
         RETURNING id, form_id, respondent_id, respondent_email, respondent_name,
                   fill_duration_secs, score, max_score, source, submitted_at",
    )
    .bind(form.id)
    .bind(body.respondent_email.as_deref())
    .bind(body.respondent_name.as_deref())
    .bind(&ip_str)
    .bind(body.fill_duration_secs)
    .bind(if has_quiz { Some(total_score) } else { None })
    .bind(if has_quiz { Some(max_score) } else { None })
    .fetch_one(&state.db)
    .await?;

    // Insert answers (with grading metadata).
    for answer in &body.answers {
        let value_str = serde_json::to_string(&answer.value).unwrap_or_else(|_| "null".to_string());
        let (is_correct, points) = match graded.get(&answer.question_id) {
            Some((c, p)) => (Some(*c), *p),
            None => (None, 0),
        };
        sqlx::query(
            "INSERT INTO forms.answers (response_id, question_id, value, is_correct, points_earned)
             VALUES ($1, $2, $3::jsonb, $4, $5)
             ON CONFLICT (response_id, question_id) DO NOTHING",
        )
        .bind(response.id)
        .bind(answer.question_id)
        .bind(&value_str)
        .bind(is_correct)
        .bind(points)
        .execute(&state.db)
        .await?;
    }

    // Webhook (fire-and-forget).
    {
        let webhook_url = form
            .settings
            .get("webhookUrl")
            .and_then(|v| v.as_str())
            .map(String::from);
        if let Some(url) = webhook_url.filter(|u| !u.is_empty()) {
            let payload = json!({
                "event":        "form.response_received",
                "form_id":      form.id,
                "form_title":   form.title,
                "response_id":  response.id,
                "submitted_at": response.submitted_at,
                "score":        response.score,
                "max_score":    response.max_score,
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

    let confirmation = form
        .settings
        .get("confirmationMessage")
        .and_then(|v| v.as_str())
        .unwrap_or("Votre réponse a bien été enregistrée.")
        .to_string();

    // Build the quiz result payload (only when results are shown to respondents).
    let show_result = form
        .settings
        .get("quizMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && form
            .settings
            .get("showResultImmediately")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

    let result = if has_quiz && show_result {
        let details: Vec<Value> = questions
            .iter()
            .filter(|q| scoring::is_scorable(q))
            .map(|q| {
                let (is_correct, points) = graded.get(&q.id).copied().unwrap_or((false, 0));
                json!({
                    "question_id":  q.id,
                    "is_correct":   is_correct,
                    "points_earned": points,
                    "points":       q.points,
                    "feedback":     if is_correct { &q.feedback_correct } else { &q.feedback_incorrect },
                })
            })
            .collect();
        Some(json!({
            "score":     total_score,
            "max_score": max_score,
            "details":   details,
        }))
    } else {
        None
    };

    Ok(Json(json!({
        "ok":           true,
        "response_id":  response.id,
        "confirmation": confirmation,
        "result":       result,
    })))
}

/// A value is "blank" when it is an empty string or empty array.
fn is_blank(v: &Value) -> bool {
    match v {
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Null => true,
        _ => false,
    }
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
