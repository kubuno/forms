-- ── Réponses ─────────────────────────────────────────────────────────────────

CREATE TABLE forms.responses (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id             UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    respondent_id       UUID,
    respondent_email    VARCHAR(255),
    respondent_name     VARCHAR(255),
    ip_address          INET,
    user_agent          TEXT,
    fill_duration_secs  INTEGER,
    score               INTEGER,
    max_score           INTEGER,
    source              VARCHAR(10) NOT NULL DEFAULT 'web'
                            CHECK (source IN ('web', 'embed', 'api')),
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forms_responses_form ON forms.responses(form_id, submitted_at DESC);
CREATE INDEX idx_forms_responses_user ON forms.responses(respondent_id)
    WHERE respondent_id IS NOT NULL;
CREATE INDEX idx_forms_responses_ip   ON forms.responses(form_id, ip_address);

-- Trigger : incrémenter response_count sur le formulaire
CREATE OR REPLACE FUNCTION forms.update_response_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE forms.forms
    SET response_count   = response_count + 1,
        last_response_at = NOW(),
        updated_at       = NOW()
    WHERE id = NEW.form_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER responses_count
    AFTER INSERT ON forms.responses
    FOR EACH ROW EXECUTE FUNCTION forms.update_response_count();

-- ── Réponses aux questions individuelles ──────────────────────────────────────

CREATE TABLE forms.answers (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    response_id UUID NOT NULL REFERENCES forms.responses(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES forms.questions(id) ON DELETE CASCADE,
    value       JSONB NOT NULL,
    is_correct  BOOLEAN,
    points_earned INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (response_id, question_id)
);

CREATE INDEX idx_forms_answers_response  ON forms.answers(response_id);
CREATE INDEX idx_forms_answers_question  ON forms.answers(question_id);
