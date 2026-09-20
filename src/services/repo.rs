//! Pool-only data access for the core form / question / response / answer
//! paths.
//!
//! These functions take a [`kubuno_db::DbPool`] and nothing else, so they run
//! against any of the three engines and can be exercised directly by
//! `tests/db_portability.rs` without an `AppState`, an HTTP layer or an
//! authenticated user. The handlers delegate to them; the portability test
//! drives the same code the handlers do.
//!
//! Two PostgreSQL habits are handled here rather than in the SQL text:
//!
//! * **`RETURNING *`** — MySQL has none. Every insert generates its primary key
//!   in Rust ([`kubuno_db::new_id`]), binds it, and re-selects the row by id.
//!   The row is knowable because the process, not the database, invented the
//!   key. The PostgreSQL migration keeps its `DEFAULT uuid_generate_v4()`, which
//!   is simply overridden.
//! * **`ON CONFLICT DO NOTHING`** and **`INET`** — spelled through
//!   [`kubuno_db::dialect`].

use serde_json::Value;
use uuid::Uuid;

use kubuno_db::dialect::Backend;
use kubuno_db::{new_id, params, DbPool};

use crate::models::form::{Form, Question};
use crate::models::response::FormResponse;

/// Every column of `forms.forms`, in one place so an insert and its re-select
/// cannot drift.
const FORM_COLS: &str = "id, owner_id, title, description, theme, header_image_path, \
     settings, public_token, response_count, last_response_at, is_trashed, \
     trashed_at, published_at, created_at, updated_at";

/// A response's public columns (ip_address / user_agent stay server-side).
const RESPONSE_COLS: &str = "id, form_id, respondent_id, respondent_email, respondent_name, \
     fill_duration_secs, score, max_score, source, submitted_at";

/// `$n`, cast to `inet` on PostgreSQL where `ip_address` is an `INET` column;
/// left as a plain placeholder on MySQL/SQLite where it is text.
pub(crate) fn inet_placeholder(backend: Backend, n: usize) -> String {
    match backend {
        Backend::Postgres => format!("${n}::inet"),
        Backend::MySql | Backend::Sqlite => format!("${n}"),
    }
}

/// Loads a form by id.
pub async fn load_form(db: &DbPool, id: Uuid) -> Result<Option<Form>, sqlx::Error> {
    db.fetch_optional_as::<Form>(
        &format!("SELECT {FORM_COLS} FROM forms.forms WHERE id = $1"),
        params![id],
    )
    .await
}

/// Creates a blank form owned by `owner_id`. Theme, settings and public token
/// come from the column defaults; the key is generated here and re-selected.
pub async fn create_form(db: &DbPool, owner_id: Uuid, title: &str) -> Result<Form, sqlx::Error> {
    let id = new_id();
    db.execute(
        "INSERT INTO forms.forms (id, owner_id, title) VALUES ($1, $2, $3)",
        params![id, owner_id, title],
    )
    .await?;
    db.fetch_one_as::<Form>(
        &format!("SELECT {FORM_COLS} FROM forms.forms WHERE id = $1"),
        params![id],
    )
    .await
}

/// Overwrites a form's editable content and returns the stored row. `updated_at`
/// is bumped by the engine (a trigger on PostgreSQL/SQLite, `ON UPDATE` on
/// MySQL), so it is not set here.
pub async fn update_form_content(
    db: &DbPool,
    id: Uuid,
    title: &str,
    description: Option<&str>,
    theme: &Value,
    settings: &Value,
) -> Result<Form, sqlx::Error> {
    db.execute(
        "UPDATE forms.forms SET title = $1, description = $2, theme = $3, settings = $4 WHERE id = $5",
        params![title, description, theme.clone(), settings.clone(), id],
    )
    .await?;
    db.fetch_one_as::<Form>(
        &format!("SELECT {FORM_COLS} FROM forms.forms WHERE id = $1"),
        params![id],
    )
    .await
}

/// Inserts a question at `position`. When `shift` is set the rows at or after
/// that slot are pushed down first, in the same transaction, so positions stay
/// ordered. The row is re-selected after commit because the key is known.
pub async fn create_question(
    db: &DbPool,
    form_id: Uuid,
    position: i32,
    shift: bool,
    question_type: &str,
    title: &str,
) -> Result<Question, sqlx::Error> {
    let id = new_id();
    let mut tx = db.begin().await?;
    if shift {
        tx.execute(
            "UPDATE forms.questions SET position = position + 1 WHERE form_id = $1 AND position >= $2",
            params![form_id, position],
        )
        .await?;
    }
    tx.execute(
        "INSERT INTO forms.questions (id, form_id, position, question_type, title) \
         VALUES ($1, $2, $3, $4, $5)",
        params![id, form_id, position, question_type, title],
    )
    .await?;
    tx.commit().await?;

    db.fetch_one_as::<Question>(
        "SELECT * FROM forms.questions WHERE id = $1",
        params![id],
    )
    .await
}

/// Persists a full question row (used by update / duplicate / import).
#[allow(clippy::too_many_arguments)]
pub async fn update_question(
    db: &DbPool,
    id: Uuid,
    question_type: &str,
    title: &str,
    description: Option<&str>,
    required: bool,
    options: &Value,
    points: i32,
    correct_answers: &Value,
    feedback_correct: Option<&str>,
    feedback_incorrect: Option<&str>,
) -> Result<Question, sqlx::Error> {
    db.execute(
        "UPDATE forms.questions \
         SET question_type = $1, title = $2, description = $3, required = $4, \
             options = $5, points = $6, correct_answers = $7, \
             feedback_correct = $8, feedback_incorrect = $9 \
         WHERE id = $10",
        params![
            question_type,
            title,
            description,
            required,
            options.clone(),
            points,
            correct_answers.clone(),
            feedback_correct,
            feedback_incorrect,
            id
        ],
    )
    .await?;
    db.fetch_one_as::<Question>("SELECT * FROM forms.questions WHERE id = $1", params![id])
        .await
}

/// Inserts a response, returning its public view. Score columns are `None`
/// outside a quiz. `id` is generated here; `submitted_at` and `response_count`
/// are handled by the column default and the insert trigger respectively.
#[allow(clippy::too_many_arguments)]
pub async fn insert_response(
    db: &DbPool,
    form_id: Uuid,
    respondent_email: Option<&str>,
    respondent_name: Option<&str>,
    ip_address: &str,
    fill_duration_secs: Option<i32>,
    score: Option<i32>,
    max_score: Option<i32>,
) -> Result<FormResponse, sqlx::Error> {
    let id = new_id();
    let sql = format!(
        "INSERT INTO forms.responses \
            (id, form_id, respondent_email, respondent_name, ip_address, \
             fill_duration_secs, score, max_score, source) \
         VALUES ($1, $2, $3, $4, {ip}, $6, $7, $8, 'web')",
        ip = inet_placeholder(db.backend(), 5),
    );
    db.execute(
        &sql,
        params![
            id,
            form_id,
            respondent_email,
            respondent_name,
            ip_address,
            fill_duration_secs,
            score,
            max_score
        ],
    )
    .await?;
    db.fetch_one_as::<FormResponse>(
        &format!("SELECT {RESPONSE_COLS} FROM forms.responses WHERE id = $1"),
        params![id],
    )
    .await
}

/// Records one answer, ignoring a duplicate `(response_id, question_id)`.
pub async fn insert_answer(
    db: &DbPool,
    response_id: Uuid,
    question_id: Uuid,
    value: &Value,
    is_correct: Option<bool>,
    points_earned: i32,
) -> Result<(), sqlx::Error> {
    let backend = db.backend();
    let sql = format!(
        "INSERT {ignore}INTO forms.answers \
            (id, response_id, question_id, value, is_correct, points_earned) \
         VALUES ($1, $2, $3, $4, $5, $6){on_conflict}",
        ignore = backend.insert_ignore_prefix(),
        on_conflict = backend.on_conflict_do_nothing(&["response_id", "question_id"]),
    );
    db.execute(
        &sql,
        params![
            new_id(),
            response_id,
            question_id,
            value.clone(),
            is_correct,
            points_earned
        ],
    )
    .await?;
    Ok(())
}
