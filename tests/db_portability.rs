//! Runs forms' own migrations and its own data layer against a real server of
//! **each** engine, from a single compiled binary — the proof that the engine
//! is a run-time choice, not a build-time one.
//!
//! * SQLite always runs (a temp file, no server).
//! * PostgreSQL runs when `KUBUNO_PG_TEST_URL` points at a throwaway database
//!   (it must have the `uuid-ossp` extension, which the frozen PostgreSQL
//!   migration relies on for its `uuid_generate_v4()` default).
//! * MySQL/MariaDB runs when `KUBUNO_MYSQL_TEST_URL` does.
//!
//! ```sh
//! KUBUNO_PG_TEST_URL=postgres://u:p@localhost:5433/forms \
//! KUBUNO_MYSQL_TEST_URL=mysql://u:p@localhost:3307/forms \
//!   cargo test --test db_portability
//! ```
//!
//! The same binary contains all three drivers; each engine's suite is one test.

use serde_json::json;
use uuid::Uuid;

use kubuno_db::params;
use kubuno_forms::models::form::Question;
use kubuno_forms::services::repo;
use kubuno_forms::SCHEMA;

fn base_settings(engine: &str) -> kubuno_db::DbSettings {
    kubuno_db::DbSettings {
        engine: engine.to_string(),
        url: None,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: None,
        max_connections: 4,
        min_connections: 0,
        connect_timeout: std::time::Duration::from_secs(10),
        run_migrations: true,
        schema_prefix: None,
    }
}

/// Migrations only run one at a time: the PostgreSQL and MySQL suites may share
/// a server.
static EXCLUSIVE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn migrated_pool(settings: kubuno_db::DbSettings) -> (kubuno_db::DbPool, impl Sized) {
    let guard = EXCLUSIVE.lock().await;
    let pool = kubuno_db::connect(&settings, SCHEMA).await.expect("connect");

    // Exactly the calls `main.rs` makes.
    kubuno_db::migrations!(
        "./migrations/postgres",
        "./migrations/mysql",
        "./migrations/sqlite",
    )
    .run(&pool, SCHEMA)
    .await
    .expect("migrations");

    kubuno_db::events::ensure_outbox(&pool, SCHEMA)
        .await
        .expect("outbox");

    (pool, guard)
}

async fn count(pool: &kubuno_db::DbPool, sql: &str, form_id: Uuid) -> i64 {
    pool.fetch_scalar::<i64>(sql, params![form_id]).await.expect("count")
}

/// The whole write path forms exercises, plus the two things that only a real
/// engine can prove portable: the response-count trigger and the ported JSON
/// key-existence operator from migration 000009.
async fn full_suite(pool: &kubuno_db::DbPool) {
    let backend = pool.backend();
    let owner = Uuid::new_v4();

    // ── create: defaults come from the migration, the key from Rust ──
    let form = repo::create_form(pool, owner, "Mon sondage").await.expect("create form");
    assert_eq!(form.owner_id, owner);
    assert_eq!(form.title, "Mon sondage");
    assert_eq!(form.response_count, 0);
    assert!(!form.is_trashed);
    assert_eq!(form.public_token.len(), 64, "public_token default must be 64 hex chars");
    // The theme default was migrated to the platform typeface (000009).
    assert_eq!(
        form.theme.get("fontFamily").and_then(|v| v.as_str()),
        Some("Outfit, Arial, sans-serif"),
    );

    // ── the ported `theme ? 'fontFamily'` operator (dialect::json_has_key) ──
    let has_key = format!(
        "SELECT {c} FROM forms.forms WHERE id = $1 AND {pred}",
        c = backend.count_bigint("*"),
        pred = backend.json_has_key("theme", "fontFamily"),
    );
    assert_eq!(count(pool, &has_key, form.id).await, 1, "theme must carry fontFamily");
    let missing_key = format!(
        "SELECT {c} FROM forms.forms WHERE id = $1 AND {pred}",
        c = backend.count_bigint("*"),
        pred = backend.json_has_key("theme", "notAKey"),
    );
    assert_eq!(count(pool, &missing_key, form.id).await, 0, "an absent key must not match");

    // ── load / update ──
    let loaded = repo::load_form(pool, form.id).await.expect("load").expect("some");
    assert_eq!(loaded.id, form.id);

    let updated = repo::update_form_content(
        pool,
        form.id,
        "Titre révisé",
        Some("Une description"),
        &json!({ "fontFamily": "Outfit, Arial, sans-serif", "style": "compact" }),
        &json!({ "acceptingResponses": true }),
    )
    .await
    .expect("update");
    assert_eq!(updated.title, "Titre révisé");
    assert_eq!(updated.description.as_deref(), Some("Une description"));
    assert_eq!(updated.theme.get("style").and_then(|v| v.as_str()), Some("compact"));

    // ── questions: create, then create-with-shift, and check the ordering ──
    let q1 = repo::create_question(pool, form.id, 0, false, "short_text", "Q1")
        .await
        .expect("q1");
    assert_eq!(q1.position, 0);
    let _q2 = repo::create_question(pool, form.id, 1, false, "multiple_choice", "Q2")
        .await
        .expect("q2");
    // Insert at slot 0 with a shift: the two existing questions move down.
    let q0 = repo::create_question(pool, form.id, 0, true, "statement", "Intro")
        .await
        .expect("q0");
    assert_eq!(q0.position, 0);

    let ordered = pool
        .fetch_all_as::<Question>(
            "SELECT * FROM forms.questions WHERE form_id = $1 ORDER BY position ASC",
            params![form.id],
        )
        .await
        .expect("ordered");
    let titles: Vec<&str> = ordered.iter().map(|q| q.title.as_str()).collect();
    assert_eq!(titles, vec!["Intro", "Q1", "Q2"], "the shift must reorder, not collide");

    // ── the update path on a question ──
    let uq = repo::update_question(
        pool,
        q1.id,
        "number",
        "Combien ?",
        None,
        true,
        &json!({ "min": 0 }),
        3,
        &json!([42]),
        Some("Bravo"),
        None,
    )
    .await
    .expect("update question");
    assert_eq!(uq.question_type, "number");
    assert!(uq.required);
    assert_eq!(uq.points, 3);

    // ── responses: insert, and the count trigger has to fire on every engine ──
    let resp = repo::insert_response(
        pool,
        form.id,
        Some("a@b.test"),
        Some("Alice"),
        "203.0.113.7",
        Some(12),
        Some(3),
        Some(3),
    )
    .await
    .expect("response");
    assert_eq!(resp.respondent_email.as_deref(), Some("a@b.test"));
    assert_eq!(resp.score, Some(3));

    let after = repo::load_form(pool, form.id).await.expect("reload").expect("some");
    assert_eq!(after.response_count, 1, "the insert trigger must bump response_count");
    assert!(after.last_response_at.is_some());

    // ── answers, including the ON CONFLICT DO NOTHING de-duplication ──
    repo::insert_answer(pool, resp.id, uq.id, &json!(42), Some(true), 3)
        .await
        .expect("answer");
    repo::insert_answer(pool, resp.id, uq.id, &json!(7), Some(false), 0)
        .await
        .expect("answer duplicate is ignored");
    let answers: i64 = pool
        .fetch_scalar(
            &format!(
                "SELECT {} FROM forms.answers WHERE response_id = $1",
                backend.count_bigint("*")
            ),
            params![resp.id],
        )
        .await
        .expect("answer count");
    assert_eq!(answers, 1, "a duplicate (response, question) answer must not be inserted");

    // ── delete cascades to questions, responses and answers ──
    pool.execute("DELETE FROM forms.forms WHERE id = $1", params![form.id])
        .await
        .expect("delete");
    assert!(repo::load_form(pool, form.id).await.expect("q").is_none());
    let remaining_q = count(
        pool,
        &format!(
            "SELECT {} FROM forms.questions WHERE form_id = $1",
            backend.count_bigint("*")
        ),
        form.id,
    )
    .await;
    assert_eq!(remaining_q, 0, "questions must cascade away with the form");
}

#[tokio::test]
async fn sqlite_from_the_one_binary() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = base_settings("sqlite");
    s.path = Some(dir.path().to_string_lossy().into_owned());
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn postgres_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_PG_TEST_URL") else {
        eprintln!("skipping: KUBUNO_PG_TEST_URL not set");
        return;
    };
    let mut s = base_settings("postgres");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn mysql_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_MYSQL_TEST_URL") else {
        eprintln!("skipping: KUBUNO_MYSQL_TEST_URL not set");
        return;
    };
    let mut s = base_settings("mysql");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}
