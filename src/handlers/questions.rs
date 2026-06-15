use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::form::*,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let questions = sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
    )
    .bind(form_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "questions": questions })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Json(body): Json<CreateQuestionDto>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;

    let qtype = body.question_type.unwrap_or_else(|| "short_text".to_string());
    let title = body.title.unwrap_or_else(|| "Question sans titre".to_string());

    let max_pos: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(position) FROM forms.questions WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    let position = body.position.unwrap_or_else(|| max_pos.unwrap_or(-1) + 1);

    let question = sqlx::query_as::<_, Question>(
        "INSERT INTO forms.questions (form_id, position, question_type, title)
         VALUES ($1, $2, $3, $4)
         RETURNING *",
    )
    .bind(form_id)
    .bind(position)
    .bind(&qtype)
    .bind(&title)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "question": question })))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, question_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateQuestionDto>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let mut q = load_question(&state, question_id, form_id).await?;

    if let Some(t) = body.question_type { q.question_type = t; }
    if let Some(t) = body.title         { if !t.is_empty() { q.title = t; } }
    if let Some(d) = body.description   { q.description = d.as_str().map(String::from); }
    if let Some(r) = body.required      { q.required = r; }
    if let Some(o) = body.options       { q.options = o; }
    if let Some(p) = body.points        { q.points = p; }
    if let Some(ca) = body.correct_answers { q.correct_answers = ca; }
    if let Some(fc) = body.feedback_correct   { q.feedback_correct = fc.as_str().map(String::from); }
    if let Some(fi) = body.feedback_incorrect { q.feedback_incorrect = fi.as_str().map(String::from); }

    let updated = sqlx::query_as::<_, Question>(
        "UPDATE forms.questions
         SET question_type = $1, title = $2, description = $3, required = $4,
             options = $5, points = $6, correct_answers = $7,
             feedback_correct = $8, feedback_incorrect = $9
         WHERE id = $10
         RETURNING *",
    )
    .bind(&q.question_type)
    .bind(&q.title)
    .bind(&q.description)
    .bind(q.required)
    .bind(&q.options)
    .bind(q.points)
    .bind(&q.correct_answers)
    .bind(&q.feedback_correct)
    .bind(&q.feedback_incorrect)
    .bind(question_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "question": updated })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, question_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    load_question(&state, question_id, form_id).await?;
    sqlx::query("DELETE FROM forms.questions WHERE id = $1")
        .bind(question_id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn reorder(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Json(items): Json<Vec<ReorderItem>>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    for item in &items {
        sqlx::query(
            "UPDATE forms.questions SET position = $1 WHERE id = $2 AND form_id = $3",
        )
        .bind(item.position)
        .bind(item.id)
        .bind(form_id)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn duplicate(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path((form_id, question_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    load_question(&state, question_id, form_id).await?;

    let max_pos: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(position) FROM forms.questions WHERE form_id = $1",
    )
    .bind(form_id)
    .fetch_one(&state.db)
    .await?;

    let new_pos = max_pos.unwrap_or(0) + 1;

    let new_q = sqlx::query_as::<_, Question>(
        "INSERT INTO forms.questions
            (form_id, position, question_type, title, description, required, options,
             points, correct_answers, feedback_correct, feedback_incorrect)
         SELECT form_id, $1, question_type, title, description, required, options,
                points, correct_answers, feedback_correct, feedback_incorrect
         FROM forms.questions WHERE id = $2
         RETURNING *",
    )
    .bind(new_pos)
    .bind(question_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "question": new_q })))
}

async fn load_question(state: &AppState, id: Uuid, form_id: Uuid) -> Result<Question> {
    sqlx::query_as::<_, Question>(
        "SELECT * FROM forms.questions WHERE id = $1 AND form_id = $2",
    )
    .bind(id)
    .bind(form_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Question {id}")))
}
