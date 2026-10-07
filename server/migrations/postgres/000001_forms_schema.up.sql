CREATE SCHEMA IF NOT EXISTS forms;

CREATE OR REPLACE FUNCTION forms.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Formulaires ───────────────────────────────────────────────────────────────

CREATE TABLE forms.forms (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id         UUID NOT NULL,
    title            VARCHAR(500) NOT NULL DEFAULT 'Formulaire sans titre',
    description      TEXT,

    theme            JSONB NOT NULL DEFAULT '{
        "primaryColor":    "#673ab7",
        "headerColor":     "#673ab7",
        "fontFamily":      "Google Sans, Arial, sans-serif",
        "backgroundImage": null,
        "style":           "default"
    }',

    header_image_path TEXT,

    settings         JSONB NOT NULL DEFAULT '{
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

    -- Token public pour le lien de partage (64 hex chars)
    public_token     VARCHAR(64) UNIQUE NOT NULL DEFAULT
        (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),

    response_count   INTEGER NOT NULL DEFAULT 0,
    last_response_at TIMESTAMPTZ,

    is_trashed       BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at       TIMESTAMPTZ,
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forms_owner   ON forms.forms(owner_id);
CREATE INDEX idx_forms_token   ON forms.forms(public_token);
CREATE INDEX idx_forms_updated ON forms.forms(owner_id, updated_at DESC);

CREATE TRIGGER forms_updated_at
    BEFORE UPDATE ON forms.forms
    FOR EACH ROW EXECUTE FUNCTION forms.set_updated_at();

-- ── Questions ─────────────────────────────────────────────────────────────────

CREATE TABLE forms.questions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id             UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    question_type       VARCHAR(30) NOT NULL DEFAULT 'short_text'
                            CHECK (question_type IN (
                                'short_text', 'long_text', 'multiple_choice', 'checkbox',
                                'dropdown', 'linear_scale', 'rating', 'date', 'time',
                                'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section'
                            )),
    title               TEXT NOT NULL DEFAULT 'Question sans titre',
    description         TEXT,
    required            BOOLEAN NOT NULL DEFAULT FALSE,
    image_path          TEXT,
    options             JSONB NOT NULL DEFAULT '{}',
    points              INTEGER NOT NULL DEFAULT 0,
    correct_answers     JSONB NOT NULL DEFAULT '[]',
    feedback_correct    TEXT,
    feedback_incorrect  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forms_questions_form ON forms.questions(form_id, position);

CREATE TRIGGER questions_updated_at
    BEFORE UPDATE ON forms.questions
    FOR EACH ROW EXECUTE FUNCTION forms.set_updated_at();

-- ── Co-éditeurs ───────────────────────────────────────────────────────────────

CREATE TABLE forms.collaborators (
    form_id  UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL,
    role     VARCHAR(10) NOT NULL DEFAULT 'editor'
                 CHECK (role IN ('editor', 'viewer')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (form_id, user_id)
);

CREATE INDEX idx_forms_collab ON forms.collaborators(user_id);
