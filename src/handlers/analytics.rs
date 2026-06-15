use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    errors::Result,
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::form::Question,
    state::AppState,
};

pub async fn global_stats(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let form = load_owned_form(&state, form_id, user.id).await?;

    let avg_duration: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(fill_duration_secs) FROM forms.responses WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    let completion_rate: f64 = 1.0; // TODO: calculer si des réponses partielles existent

    Ok(Json(json!({
        "total_responses": form.response_count,
        "last_response_at": form.last_response_at,
        "avg_fill_duration_secs": avg_duration,
        "completion_rate": completion_rate,
    })))
}

pub async fn question_stats(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1
         AND question_type NOT IN ('image', 'video', 'section')
         ORDER BY position ASC",
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;

    let total_responses: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM forms.responses WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    let mut stats = Vec::new();

    for q in &questions {
        let answers: Vec<Value> = sqlx::query_scalar(
            "SELECT value FROM forms.answers WHERE question_id = $1",
        )
        .bind(q.id)
        .fetch_all(&state.db)
        .await?;

        let stat = compute_question_stats(q, &answers, total_responses);
        stats.push(stat);
    }

    Ok(Json(json!({ "stats": stats })))
}

fn compute_question_stats(q: &Question, answers: &[Value], total_responses: i64) -> Value {
    let total_answers = answers.len() as i64;

    match q.question_type.as_str() {
        "multiple_choice" | "checkbox" | "dropdown" => {
            let opts = q.options.get("options")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let mut counts: HashMap<String, i64> = HashMap::new();
            for ans in answers {
                match ans {
                    Value::String(s) => {
                        *counts.entry(s.clone()).or_default() += 1;
                    }
                    Value::Array(arr) => {
                        for item in arr {
                            if let Some(s) = item.as_str() {
                                *counts.entry(s.to_string()).or_default() += 1;
                            }
                        }
                    }
                    _ => {}
                }
            }

            let distribution: Vec<Value> = opts.iter().filter_map(|o| {
                let id = o.get("id")?.as_str()?;
                let label = o.get("label")?.as_str().unwrap_or("");
                let count = *counts.get(id).unwrap_or(&0);
                let pct = if total_answers > 0 {
                    (count as f64 / total_answers as f64 * 100.0).round() as i64
                } else { 0 };
                Some(json!({ "option_id": id, "label": label, "count": count, "percentage": pct }))
            }).collect();

            json!({
                "question_id": q.id,
                "question_type": q.question_type,
                "title": q.title,
                "total_answers": total_answers,
                "stat_type": "distribution",
                "distribution": distribution,
            })
        }

        "linear_scale" | "rating" => {
            let values: Vec<f64> = answers.iter()
                .filter_map(|a| a.as_f64())
                .collect();

            let mean = if values.is_empty() { 0.0 }
                       else { values.iter().sum::<f64>() / values.len() as f64 };

            let mut sorted = values.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let median = if sorted.is_empty() { 0.0 }
                         else { sorted[sorted.len() / 2] };

            // Frequency distribution
            let mut freq: HashMap<String, i64> = HashMap::new();
            for v in &values {
                *freq.entry(format!("{v}")).or_default() += 1;
            }

            json!({
                "question_id": q.id,
                "question_type": q.question_type,
                "title": q.title,
                "total_answers": total_answers,
                "stat_type": "scale",
                "mean": (mean * 100.0).round() / 100.0,
                "median": median,
                "frequency": freq,
            })
        }

        "short_text" | "long_text" => {
            let texts: Vec<&str> = answers.iter()
                .filter_map(|a| a.as_str())
                .take(100)
                .collect();

            json!({
                "question_id": q.id,
                "question_type": q.question_type,
                "title": q.title,
                "total_answers": total_answers,
                "total_form_responses": total_responses,
                "stat_type": "text",
                "texts": texts,
            })
        }

        _ => json!({
            "question_id": q.id,
            "question_type": q.question_type,
            "title": q.title,
            "total_answers": total_answers,
            "stat_type": "raw",
        }),
    }
}
