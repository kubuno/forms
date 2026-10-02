use axum::{
    extract::{ConnectInfo, Path, State},
    Json,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use uuid::Uuid;

use kubuno_db::params;
use kubuno_forms_core::{
    validate_submission, AnswerInput as CoreAnswer, DisplayMode, Issue, IssueCode, QuestionSpec, Rule,
};

use crate::{
    errors::{FormsError, Result},
    models::{form::*, logic::ConditionalRule, response::*},
    services::{repo, scoring},
    state::AppState,
};


/// Returns the public view of a form (title, description, questions, theme, logic).
/// Sensitive quiz data (correct answers, points, feedback) is never exposed here.
pub async fn get_form(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>> {
    let form = load_public_form(&state, &token).await?;
    check_accepting(&form)?;

    let questions = state.db.fetch_all_as::<Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
        params![form.id],
    )
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

    let rules = state.db.fetch_all_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE form_id = $1 ORDER BY position ASC",
        params![form.id],
    )
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
    validate_respondent(&body)?;

    // Anti-spam: cooldown between submissions from the same IP (instance setting).
    let cooldown = state.instance().submission_cooldown_secs;
    if cooldown > 0 {
        let ip = addr.ip().to_string();
        // The cutoff is computed in Rust and bound, rather than built with
        // NOW()/INTERVAL, which the three engines spell differently.
        let cutoff = chrono::Utc::now() - chrono::Duration::seconds(cooldown);
        let sql = format!(
            "SELECT {cnt} FROM forms.responses
             WHERE form_id = $1 AND ip_address = {ip} AND submitted_at > $3",
            cnt = state.db.backend().count_bigint("*"),
            ip = repo::inet_placeholder(state.db.backend(), 2),
        );
        let recent: i64 = state.db.fetch_scalar(&sql, params![form.id, &ip, cutoff]).await?;

        if recent > 0 {
            return Err(FormsError::TooManyRequests);
        }
    }

    // Load all questions (with scoring data, used server-side only).
    let questions = state.db.fetch_all_as::<Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
        params![form.id],
    )
    .await?;

    // Validate the submission with the shared core (kubuno-forms-core): the
    // conditional logic is evaluated here exactly as the public page evaluates
    // it, so required questions are enforced on every form, with or without
    // rules, and answers are checked against their question type. Answers to
    // questions the respondent did not reach (hidden or jumped over), to
    // content blocks or to unknown questions are not stored.
    let rules = state.db.fetch_all_as::<ConditionalRule>(
        "SELECT * FROM forms.conditional_rules WHERE form_id = $1 ORDER BY position ASC",
        params![form.id],
    )
    .await?;
    let answers = validated_answers(&state, &form, &questions, &rules, body.answers).await?;

    // ── Quiz scoring ────────────────────────────────────────────────────────
    let max_score: i32 = questions.iter().filter(|q| scoring::is_scorable(q)).map(|q| q.points).sum();
    let has_quiz = max_score > 0;

    let question_by_id: std::collections::HashMap<Uuid, &Question> =
        questions.iter().map(|q| (q.id, q)).collect();

    let mut total_score = 0i32;
    // Per-answer grading, keyed by question id.
    let mut graded: std::collections::HashMap<Uuid, (bool, i32)> = std::collections::HashMap::new();
    for answer in &answers {
        if let Some(q) = question_by_id.get(&answer.question_id) {
            if scoring::is_scorable(q) {
                let g = scoring::grade(q, &answer.value);
                total_score += g.points_earned;
                graded.insert(answer.question_id, (g.is_correct, g.points_earned));
            }
        }
    }

    // Insert the response (with score when this is a quiz). The response-count
    // increment on the form is done by the insert trigger on every engine.
    let ip_str = addr.ip().to_string();
    let response = repo::insert_response(
        &state.db,
        form.id,
        body.respondent_email.as_deref(),
        body.respondent_name.as_deref(),
        &ip_str,
        body.fill_duration_secs,
        if has_quiz { Some(total_score) } else { None },
        if has_quiz { Some(max_score) } else { None },
    )
    .await?;

    // Insert answers (with grading metadata).
    for answer in &answers {
        let (is_correct, points) = match graded.get(&answer.question_id) {
            Some((c, p)) => (Some(*c), *p),
            None => (None, 0),
        };
        repo::insert_answer(
            &state.db,
            response.id,
            answer.question_id,
            &answer.value,
            is_correct,
            points,
        )
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

/// Longest accepted respondent name, in characters.
const MAX_RESPONDENT_NAME: usize = 200;

/// Runs the shared core over a submission and returns the answers to store (those of questions the respondent
/// reached, in submission order). Refuses the submission with the list of issues otherwise.
async fn validated_answers(
    state: &AppState,
    form: &crate::models::form::Form,
    questions: &[Question],
    rules: &[ConditionalRule],
    submitted: Vec<AnswerInput>,
) -> Result<Vec<AnswerInput>> {
    let specs: Vec<QuestionSpec> = questions
        .iter()
        .map(|q| QuestionSpec {
            id: q.id.to_string(),
            question_type: q.question_type.clone(),
            required: q.required,
            options: q.options.clone(),
            title: q.title.clone(),
        })
        .collect();
    let core_rules: Vec<Rule> = rules
        .iter()
        .map(|r| Rule {
            trigger_question_id: r.trigger_question_id.to_string(),
            operator: r.operator.clone(),
            compare_value: r.compare_value.clone().unwrap_or(Value::Null),
            action: r.action.clone(),
            target_section_id: r.target_section_id.map(|id| id.to_string()),
            position: i64::from(r.position),
        })
        .collect();
    let inputs: Vec<CoreAnswer> = submitted
        .iter()
        .map(|a| CoreAnswer { question_id: a.question_id.to_string(), value: a.value.clone() })
        .collect();

    let verdict = validate_submission(&specs, &core_rules, DisplayMode::from_settings(&form.settings), &inputs);
    if !verdict.is_ok() {
        return Err(submission_error(&specs, &verdict.issues));
    }

    // Keep the accepted answers, once each, in submission order.
    let mut keep: std::collections::HashSet<String> = verdict.accepted.into_iter().collect();
    let answers: Vec<AnswerInput> = submitted.into_iter().filter(|a| keep.remove(&a.question_id.to_string())).collect();

    // A file answer must name a file uploaded to this very form.
    let file_questions: std::collections::HashSet<Uuid> =
        questions.iter().filter(|q| q.question_type == "file_upload").map(|q| q.id).collect();
    for a in answers.iter().filter(|a| file_questions.contains(&a.question_id)) {
        let file_id = a.value.get("fileId").and_then(Value::as_str).and_then(|s| Uuid::parse_str(s).ok());
        let known = match file_id {
            Some(id) => {
                let n: i64 = state.db.fetch_scalar(
                    &format!(
                        "SELECT {} FROM forms.uploads WHERE id = $1 AND form_id = $2",
                        state.db.backend().count_bigint("*")
                    ),
                    params![id, form.id],
                )
                .await?;
                n > 0
            }
            None => false,
        };
        if !known {
            let issue = Issue { question_id: a.question_id.to_string(), code: IssueCode::InvalidFormat };
            return Err(submission_error(&specs, &[issue]));
        }
    }
    Ok(answers)
}

/// The 422 answer of a refused submission: a message naming the first question at fault, and every issue (question
/// id + stable code) so that a client can mark each field.
fn submission_error(specs: &[QuestionSpec], issues: &[Issue]) -> FormsError {
    let title = |id: &str| {
        specs
            .iter()
            .find(|q| q.id == id)
            .map(|q| plain_title(&q.title))
            .unwrap_or_default()
    };
    let message = match issues.first() {
        Some(i) if i.code == IssueCode::Required => format!("Question requise sans réponse : {}", title(&i.question_id)),
        Some(i) => format!("Réponse invalide : {}", title(&i.question_id)),
        None => "Réponse invalide".to_string(),
    };
    FormsError::Submission { message, issues: serde_json::to_value(issues).unwrap_or(Value::Null) }
}

/// Question titles are rich text: drop the tags for an error message.
fn plain_title(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim().to_string()
}

/// Checks the respondent fields of a submission (an e-mail, when given, must be a valid address).
fn validate_respondent(body: &SubmitFormDto) -> Result<()> {
    if let Some(email) = body.respondent_email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        if email.chars().count() > 254 || !kubuno_forms_core::validate::is_valid_email(email) {
            return Err(FormsError::Validation("Adresse e-mail invalide".into()));
        }
    }
    if body.respondent_name.as_deref().is_some_and(|n| n.chars().count() > MAX_RESPONDENT_NAME) {
        return Err(FormsError::Validation("Nom trop long".into()));
    }
    if body.fill_duration_secs.is_some_and(|d| d < 0) {
        return Err(FormsError::Validation("Durée de remplissage invalide".into()));
    }
    Ok(())
}
async fn load_public_form(state: &AppState, token: &str) -> Result<crate::models::form::Form> {
    state.db.fetch_optional_as::<crate::models::form::Form>(
        "SELECT * FROM forms.forms WHERE public_token = $1 AND is_trashed = FALSE",
        params![token],
    )
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
