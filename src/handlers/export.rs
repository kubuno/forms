use axum::{
    extract::{Path, State},
    response::Response,
    Extension,
};
use axum::http::{header, StatusCode};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::{form::Question, response::*},
    state::AppState,
};

pub async fn csv(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Response> {
    let form = load_owned_form(&state, form_id, user.id).await?;

    let questions: Vec<Question> = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1
         AND question_type NOT IN ('image', 'video', 'section')
         ORDER BY position ASC",
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;

    let responses: Vec<FormResponse> = sqlx::query_as::<_, FormResponse>(
        "SELECT id, form_id, respondent_id, respondent_email, respondent_name,
                fill_duration_secs, score, max_score, source, submitted_at
         FROM forms.responses WHERE form_id = $1 ORDER BY submitted_at DESC",
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;

    // Build CSV in memory
    let mut wtr = csv::Writer::from_writer(vec![]);

    // Header row
    // Include the quiz score columns only when at least one response was graded.
    let has_quiz = responses.iter().any(|r| r.max_score.is_some());

    let mut headers = vec![
        "ID Réponse".to_string(),
        "Date de soumission".to_string(),
        "Email répondant".to_string(),
        "Nom répondant".to_string(),
        "Durée (s)".to_string(),
    ];
    if has_quiz {
        headers.push("Score".to_string());
        headers.push("Score max".to_string());
    }
    for q in &questions {
        headers.push(q.title.clone());
    }
    wtr.write_record(&headers)
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e.to_string())))?;

    for resp in &responses {
        let answers: Vec<Answer> = sqlx::query_as::<_, Answer>(
            "SELECT * FROM forms.answers WHERE response_id = $1",
        )
        .bind(resp.id)
        .fetch_all(&state.db)
        .await?;

        let mut row = vec![
            resp.id.to_string(),
            resp.submitted_at.format("%d/%m/%Y %H:%M").to_string(),
            resp.respondent_email.clone().unwrap_or_default(),
            resp.respondent_name.clone().unwrap_or_default(),
            resp.fill_duration_secs.map(|s| s.to_string()).unwrap_or_default(),
        ];
        if has_quiz {
            row.push(resp.score.map(|s| s.to_string()).unwrap_or_default());
            row.push(resp.max_score.map(|s| s.to_string()).unwrap_or_default());
        }

        for q in &questions {
            let ans_val = answers.iter()
                .find(|a| a.question_id == q.id)
                .map(|a| format_csv_value(&a.value))
                .unwrap_or_default();
            row.push(ans_val);
        }

        wtr.write_record(&row)
            .map_err(|e| FormsError::Internal(anyhow::anyhow!(e.to_string())))?;
    }

    let data = wtr.into_inner()
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e.to_string())))?;

    let filename = format!(
        "reponses_{}.csv",
        form.title.chars().filter(|c| c.is_alphanumeric() || *c == '-').collect::<String>()
    );

    let body = axum::body::Body::from(data);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(body)
        .map_err(|e| FormsError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(response)
}

fn format_csv_value(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|i| i.as_str().map(String::from))
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => if *b { "Oui" } else { "Non" }.to_string(),
        serde_json::Value::Null => String::new(),
        _ => v.to_string(),
    }
}
