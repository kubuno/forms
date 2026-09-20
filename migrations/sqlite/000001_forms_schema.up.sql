-- SQLite. `forms` is an ATTACHed database file, attached on every pooled
-- connection by kubuno-db, so the qualified names below resolve as they do on
-- the other two engines. A foreign key names the referenced table WITHOUT a
-- schema prefix: SQLite resolves it in the same (attached) database.
--
-- Differences from the PostgreSQL file, and why:
--   * UUID  -> BLOB, TIMESTAMPTZ -> TEXT (`%F %T%.f`, UTC), JSONB -> TEXT,
--     BOOLEAN -> INTEGER (0/1) — what sqlx encodes/decodes on SQLite.
--   * No DEFAULT on `id`: the process supplies the key.
--   * public_token defaults to 64 random hex chars (hex(randomblob(32))).
--   * The set_updated_at trigger is written by hand; it does not recurse
--     because SQLite leaves recursive_triggers off.
--   * The question_type CHECK set and the theme DEFAULT are declared here at
--     their FINAL values (the ones PG reaches after 000004/000006/000007/
--     000008/000009), because SQLite cannot ALTER a CHECK constraint or a
--     column DEFAULT once the table exists.

CREATE TABLE forms.forms (
    id               BLOB    NOT NULL PRIMARY KEY,
    owner_id         BLOB    NOT NULL,
    title            TEXT    NOT NULL DEFAULT 'Formulaire sans titre',
    description      TEXT,

    theme            TEXT    NOT NULL DEFAULT '{
        "primaryColor":    "#673ab7",
        "headerColor":     "#673ab7",
        "fontFamily":      "Outfit, Arial, sans-serif",
        "backgroundImage": null,
        "style":           "default"
    }',

    header_image_path TEXT,

    settings         TEXT    NOT NULL DEFAULT '{
        "collectEmail":          false,
        "limitToOneResponse":    false,
        "allowEditAfterSubmit":  false,
        "showProgressBar":       true,
        "shuffleQuestions":      false,
        "requireSignIn":         false,
        "confirmationMessage":   "Votre réponse a bien été enregistrée.",
        "sendConfirmationEmail": false,
        "acceptingResponses":    true,
        "closeDate":             null,
        "maxResponses":          null,
        "webhookUrl":            null
    }',

    public_token     TEXT    NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(32)))),

    response_count   INTEGER NOT NULL DEFAULT 0,
    last_response_at TEXT,

    is_trashed       INTEGER NOT NULL DEFAULT 0,
    trashed_at       TEXT,
    published_at     TEXT,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX forms.idx_forms_owner   ON forms(owner_id);
CREATE INDEX forms.idx_forms_token   ON forms(public_token);
CREATE INDEX forms.idx_forms_updated ON forms(owner_id, updated_at DESC);

CREATE TRIGGER forms.forms_updated_at AFTER UPDATE ON forms
BEGIN
    UPDATE forms SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TABLE forms.questions (
    id                  BLOB    NOT NULL PRIMARY KEY,
    form_id             BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    question_type       TEXT    NOT NULL DEFAULT 'short_text'
                            CHECK (question_type IN (
                                'short_text', 'long_text', 'multiple_choice', 'checkbox',
                                'dropdown', 'linear_scale', 'rating', 'date', 'time',
                                'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section',
                                'yes_no', 'email', 'number', 'phone', 'url', 'opinion_scale',
                                'ranking', 'statement', 'welcome_screen', 'thank_you_screen', 'signature',
                                'field_group', 'birthday', 'address'
                            )),
    title               TEXT    NOT NULL DEFAULT 'Question sans titre',
    description         TEXT,
    required            INTEGER NOT NULL DEFAULT 0,
    image_path          TEXT,
    options             TEXT    NOT NULL DEFAULT '{}',
    points              INTEGER NOT NULL DEFAULT 0,
    correct_answers     TEXT    NOT NULL DEFAULT '[]',
    feedback_correct    TEXT,
    feedback_incorrect  TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX forms.idx_forms_questions_form ON questions(form_id, position);

CREATE TRIGGER forms.questions_updated_at AFTER UPDATE ON questions
BEGIN
    UPDATE questions SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TABLE forms.collaborators (
    form_id  BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id  BLOB    NOT NULL,
    role     TEXT    NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
    added_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (form_id, user_id)
);

CREATE INDEX forms.idx_forms_collab ON collaborators(user_id);
