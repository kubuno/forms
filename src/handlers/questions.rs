use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use kubuno_db::dialect::SqlType;
use kubuno_db::{new_id, params};

use crate::{
    errors::{FormsError, Result},
    handlers::forms::load_owned_form,
    middleware::FormsUser,
    models::form::*,
    services::repo,
    state::AppState,
};

/// `COALESCE(MAX(position), -1) + 1` as the next free slot, cast so the result
/// decodes as `i64` on all three engines (MySQL widens integer arithmetic to
/// BIGINT, PostgreSQL keeps `int4`), then narrowed back to the column's `i32`.
async fn next_position(state: &AppState, form_id: Uuid) -> Result<i32> {
    let expr = state
        .db
        .backend()
        .cast("COALESCE(MAX(position), -1) + 1", SqlType::BigInt);
    let next: i64 = state
        .db
        .fetch_scalar(
            &format!("SELECT {expr} FROM forms.questions WHERE form_id = $1"),
            params![form_id],
        )
        .await?;
    Ok(next as i32)
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    let questions = state.db.fetch_all_as::<Question>(
        "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
        params![form_id],
    )
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

    // Instance cap on the number of questions a single form may hold.
    let max_q: i64 = state.instance().max_questions;
    let current: i64 = state.db.fetch_scalar(
        &format!(
            "SELECT {} FROM forms.questions WHERE form_id = $1",
            state.db.backend().count_bigint("*")
        ),
        params![form_id],
    )
    .await?;
    if current >= max_q {
        return Err(FormsError::Validation(format!(
            "Ce formulaire a atteint la limite de {max_q} questions."
        )));
    }

    let qtype = body.question_type.unwrap_or_else(|| "short_text".to_string());
    // Default title follows the kind of block being created.
    let title = body.title.unwrap_or_else(|| match qtype.as_str() {
        "section"          => "Section sans titre".to_string(),
        "statement"        => "Titre".to_string(),
        "image"            => "Image".to_string(),
        "video"            => "Vidéo".to_string(),
        _                  => "Question sans titre".to_string(),
    });

    // Inserting in the middle pushes everything at or after that slot down first;
    // repo::create_question does the shift and the insert in one transaction.
    let shift = body.position.is_some();
    let position = match body.position {
        Some(p) => p,
        None => next_position(&state, form_id).await?,
    };

    let question = repo::create_question(&state.db, form_id, position, shift, &qtype, &title)
        .await
        .map_err(|e| {
            tracing::error!(form_id = %form_id, error = %e, "Création de question échouée");
            e
        })?;

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
    // Rich text in, sanitised at the door (see crate::richtext).
    if let Some(t) = body.title {
        if !t.is_empty() { q.title = crate::richtext::clean_required(&t, &q.title); }
    }
    if let Some(d) = body.description {
        q.description = d.as_str().and_then(crate::richtext::clean);
    }
    if let Some(r) = body.required      { q.required = r; }
    if let Some(o) = body.options       { q.options = o; }
    if let Some(p) = body.points        { q.points = p; }
    if let Some(ca) = body.correct_answers { q.correct_answers = ca; }
    if let Some(fc) = body.feedback_correct   { q.feedback_correct = fc.as_str().map(String::from); }
    if let Some(fi) = body.feedback_incorrect { q.feedback_incorrect = fi.as_str().map(String::from); }

    let updated = repo::update_question(
        &state.db,
        question_id,
        &q.question_type,
        &q.title,
        q.description.as_deref(),
        q.required,
        &q.options,
        q.points,
        &q.correct_answers,
        q.feedback_correct.as_deref(),
        q.feedback_incorrect.as_deref(),
    )
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
    state.db.execute("DELETE FROM forms.questions WHERE id = $1", params![question_id]).await?;
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
        state.db.execute(
            "UPDATE forms.questions SET position = $1 WHERE id = $2 AND form_id = $3",
            params![item.position, item.id, form_id],
        )
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

    let new_pos = next_position(&state, form_id).await?;

    // Copy exactly one row (WHERE id = $3), giving it a fresh key generated here
    // so the result can be re-selected without RETURNING.
    let new_id_q = new_id();
    state.db.execute(
        "INSERT INTO forms.questions
            (id, form_id, position, question_type, title, description, required, options,
             points, correct_answers, feedback_correct, feedback_incorrect)
         SELECT $1, form_id, $2, question_type, title, description, required, options,
                points, correct_answers, feedback_correct, feedback_incorrect
         FROM forms.questions WHERE id = $3",
        params![new_id_q, new_pos, question_id],
    )
    .await?;
    let new_q = state.db.fetch_one_as::<Question>(
        "SELECT * FROM forms.questions WHERE id = $1",
        params![new_id_q],
    )
    .await?;

    Ok(Json(json!({ "question": new_q })))
}

async fn load_question(state: &AppState, id: Uuid, form_id: Uuid) -> Result<Question> {
    state.db.fetch_optional_as::<Question>(
        "SELECT * FROM forms.questions WHERE id = $1 AND form_id = $2",
        params![id, form_id],
    )
    .await?
    .ok_or_else(|| FormsError::NotFound(format!("Question {id}")))
}

#[derive(serde::Deserialize)]
pub struct ImportQuestionsDto {
    pub source_form_id: Uuid,
    /// Questions to copy, in the order the user picked them.
    pub question_ids:   Vec<Uuid>,
}

/// Copy questions from ANOTHER form owned by the same user, appended at the end.
/// Both forms are ownership-checked: importing is never a way to read a form
/// the caller does not own.
pub async fn import(
    State(state): State<AppState>,
    Extension(user): Extension<FormsUser>,
    Path(form_id): Path<Uuid>,
    Json(body): Json<ImportQuestionsDto>,
) -> Result<Json<Value>> {
    load_owned_form(&state, form_id, user.id).await?;
    load_owned_form(&state, body.source_form_id, user.id).await?;

    if body.question_ids.is_empty() {
        return Err(FormsError::Validation("Aucune question sélectionnée".into()));
    }
    if body.source_form_id == form_id {
        return Err(FormsError::Validation(
            "Le formulaire source doit être différent du formulaire cible".into(),
        ));
    }

    // Instance cap: the batch must not push the form past its question limit.
    let max_q: i64 = state.instance().max_questions;
    let current: i64 = state.db.fetch_scalar(
        &format!(
            "SELECT {} FROM forms.questions WHERE form_id = $1",
            state.db.backend().count_bigint("*")
        ),
        params![form_id],
    )
    .await?;
    if current + body.question_ids.len() as i64 > max_q {
        return Err(FormsError::Validation(format!(
            "L'import dépasserait la limite de {max_q} questions de ce formulaire."
        )));
    }

    let next_expr = state
        .db
        .backend()
        .cast("COALESCE(MAX(position), -1) + 1", SqlType::BigInt);

    let mut tx = state.db.begin().await?;

    let next: i64 = tx
        .fetch_optional_scalar(
            &format!("SELECT {next_expr} FROM forms.questions WHERE form_id = $1"),
            params![form_id],
        )
        .await?
        .unwrap_or(0);

    let mut imported = 0i32;
    for (i, qid) in body.question_ids.iter().enumerate() {
        // Each imported row copies exactly one source row and gets a fresh key
        // (generated here, so no RETURNING is needed).
        let res = tx.execute(
            "INSERT INTO forms.questions
                (id, form_id, position, question_type, title, description, required, options,
                 points, correct_answers, feedback_correct, feedback_incorrect)
             SELECT $1, $2, $3, question_type, title, description, required, options,
                    points, correct_answers, feedback_correct, feedback_incorrect
             FROM forms.questions WHERE id = $4 AND form_id = $5",
            params![new_id(), form_id, next as i32 + i as i32, qid, body.source_form_id],
        )
        .await;
        match res {
            Ok(rows) => imported += rows as i32,
            Err(e) => {
                tracing::error!(question_id = %qid, error = %e, "Import de question échoué");
                return Err(e.into());
            }
        }
    }

    tx.commit().await?;
    Ok(Json(json!({ "imported": imported })))
}
