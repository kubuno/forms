-- MySQL / MariaDB. The `forms` database is created by kubuno-db's
-- `ensure_schema` before the migrator runs, so there is no CREATE DATABASE here.
--
-- Differences from the PostgreSQL file, and why:
--   * UUID        -> BINARY(16): what sqlx encodes a `uuid::Uuid` as on MySQL.
--   * No DEFAULT on `id`: MySQL has no gen_random_uuid(), and the process has to
--     know the key anyway since MySQL has no RETURNING; it is generated in Rust.
--   * TIMESTAMPTZ -> DATETIME(6): MySQL has no time zone in the column; every
--     value written is UTC, as produced by chrono.
--   * JSONB       -> JSON; a JSON column default must be an expression, so
--     the compiled defaults are set as parenthesised literals via ALTER.
--   * public_token keeps a database-side default so a plain INSERT (id, owner,
--     title) still gets a unique link; UUID() replaces gen_random_uuid().
--   * The set_updated_at trigger becomes ON UPDATE CURRENT_TIMESTAMP(6).
--   * The question_type / operator / action CHECK sets and the question_type
--     width are declared here at their FINAL values (the ones PG reaches after
--     migrations 000004/000006/000007/000008), because carrying the exact same
--     CHECK evolution adds risk without changing the destination.

CREATE TABLE forms.forms (
    id               BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id         BINARY(16)   NOT NULL,
    title            VARCHAR(500) NOT NULL DEFAULT 'Formulaire sans titre',
    description      TEXT,

    theme            JSON NOT NULL,

    header_image_path TEXT,

    settings         JSON NOT NULL,

    -- Public share token (64 hex chars). Two concatenated UUIDs, dashes removed.
    public_token     VARCHAR(64)  NOT NULL UNIQUE
                         DEFAULT (CONCAT(REPLACE(UUID(), '-', ''), REPLACE(UUID(), '-', ''))),

    response_count   INT          NOT NULL DEFAULT 0,
    last_response_at DATETIME(6)  NULL,

    is_trashed       TINYINT(1)   NOT NULL DEFAULT 0,
    trashed_at       DATETIME(6)  NULL,
    published_at     DATETIME(6)  NULL,
    created_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                  ON UPDATE CURRENT_TIMESTAMP(6),

    INDEX idx_forms_owner   (owner_id),
    INDEX idx_forms_token   (public_token),
    INDEX idx_forms_updated (owner_id, updated_at DESC)
);

-- JSON columns cannot take a literal DEFAULT, only an expression one; set the
-- compiled defaults through ALTER so the CREATE stays readable.
ALTER TABLE forms.forms ALTER COLUMN theme SET DEFAULT ('{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Google Sans, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}');

ALTER TABLE forms.forms ALTER COLUMN settings SET DEFAULT ('{
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
}');

CREATE TABLE forms.questions (
    id                  BINARY(16)  NOT NULL PRIMARY KEY,
    form_id             BINARY(16)  NOT NULL,
    position            INT         NOT NULL DEFAULT 0,
    question_type       VARCHAR(40) NOT NULL DEFAULT 'short_text',
    title               TEXT        NOT NULL,
    description         TEXT,
    required            TINYINT(1)  NOT NULL DEFAULT 0,
    image_path          TEXT,
    options             JSON        NOT NULL,
    points              INT         NOT NULL DEFAULT 0,
    correct_answers     JSON        NOT NULL,
    feedback_correct    TEXT,
    feedback_incorrect  TEXT,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                    ON UPDATE CURRENT_TIMESTAMP(6),

    CONSTRAINT questions_question_type_check CHECK (question_type IN (
        'short_text', 'long_text', 'multiple_choice', 'checkbox',
        'dropdown', 'linear_scale', 'rating', 'date', 'time',
        'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section',
        'yes_no', 'email', 'number', 'phone', 'url', 'opinion_scale',
        'ranking', 'statement', 'welcome_screen', 'thank_you_screen', 'signature',
        'field_group', 'birthday', 'address'
    )),
    CONSTRAINT fk_questions_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    INDEX idx_forms_questions_form (form_id, position)
);

ALTER TABLE forms.questions ALTER COLUMN options         SET DEFAULT ('{}');
ALTER TABLE forms.questions ALTER COLUMN correct_answers SET DEFAULT ('[]');

CREATE TABLE forms.collaborators (
    form_id  BINARY(16)  NOT NULL,
    user_id  BINARY(16)  NOT NULL,
    role     VARCHAR(10) NOT NULL DEFAULT 'editor',
    added_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (form_id, user_id),
    CONSTRAINT collaborators_role_check CHECK (role IN ('editor', 'viewer')),
    CONSTRAINT fk_collaborators_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    INDEX idx_forms_collab (user_id)
);
