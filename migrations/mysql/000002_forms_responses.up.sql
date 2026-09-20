-- Responses and answers. INET has no MySQL equivalent, so ip_address is stored
-- as text; the partial index on respondent_id becomes a full index (MySQL has
-- no partial indexes). The PL/pgSQL response-count trigger becomes a single
-- UPDATE trigger.
CREATE TABLE forms.responses (
    id                  BINARY(16)  NOT NULL PRIMARY KEY,
    form_id             BINARY(16)  NOT NULL,
    respondent_id       BINARY(16)  NULL,
    respondent_email    VARCHAR(255),
    respondent_name     VARCHAR(255),
    ip_address          VARCHAR(45),
    user_agent          TEXT,
    fill_duration_secs  INT,
    score               INT,
    max_score           INT,
    source              VARCHAR(10) NOT NULL DEFAULT 'web',
    submitted_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT responses_source_check CHECK (source IN ('web', 'embed', 'api')),
    CONSTRAINT fk_responses_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    INDEX idx_forms_responses_form (form_id, submitted_at DESC),
    INDEX idx_forms_responses_user (respondent_id),
    INDEX idx_forms_responses_ip   (form_id, ip_address)
);

CREATE TRIGGER forms.responses_count AFTER INSERT ON forms.responses
    FOR EACH ROW
    UPDATE forms.forms
       SET response_count   = response_count + 1,
           last_response_at = NEW.submitted_at,
           updated_at       = CURRENT_TIMESTAMP(6)
     WHERE id = NEW.form_id;

CREATE TABLE forms.answers (
    id            BINARY(16)  NOT NULL PRIMARY KEY,
    response_id   BINARY(16)  NOT NULL,
    question_id   BINARY(16)  NOT NULL,
    value         JSON        NOT NULL,
    is_correct    TINYINT(1)  NULL,
    points_earned INT         NOT NULL DEFAULT 0,
    created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE (response_id, question_id),
    CONSTRAINT fk_answers_response FOREIGN KEY (response_id)
        REFERENCES forms.responses(id) ON DELETE CASCADE,
    CONSTRAINT fk_answers_question FOREIGN KEY (question_id)
        REFERENCES forms.questions(id) ON DELETE CASCADE,
    INDEX idx_forms_answers_response (response_id),
    INDEX idx_forms_answers_question (question_id)
);
