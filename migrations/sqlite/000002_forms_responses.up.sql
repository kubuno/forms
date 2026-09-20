-- Responses and answers. INET has no SQLite equivalent, so ip_address is TEXT.
-- The partial index on respondent_id is kept (SQLite supports partial indexes).
-- The response-count trigger is written by hand.
CREATE TABLE forms.responses (
    id                  BLOB    NOT NULL PRIMARY KEY,
    form_id             BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    respondent_id       BLOB,
    respondent_email    TEXT,
    respondent_name     TEXT,
    ip_address          TEXT,
    user_agent          TEXT,
    fill_duration_secs  INTEGER,
    score               INTEGER,
    max_score           INTEGER,
    source              TEXT    NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'embed', 'api')),
    submitted_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX forms.idx_forms_responses_form ON responses(form_id, submitted_at DESC);
CREATE INDEX forms.idx_forms_responses_user ON responses(respondent_id)
    WHERE respondent_id IS NOT NULL;
CREATE INDEX forms.idx_forms_responses_ip   ON responses(form_id, ip_address);

CREATE TRIGGER forms.responses_count AFTER INSERT ON responses
BEGIN
    UPDATE forms
       SET response_count   = response_count + 1,
           last_response_at = NEW.submitted_at,
           updated_at       = strftime('%Y-%m-%d %H:%M:%f', 'now')
     WHERE id = NEW.form_id;
END;

CREATE TABLE forms.answers (
    id            BLOB    NOT NULL PRIMARY KEY,
    response_id   BLOB    NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    question_id   BLOB    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    value         TEXT    NOT NULL,
    is_correct    INTEGER,
    points_earned INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (response_id, question_id)
);

CREATE INDEX forms.idx_forms_answers_response ON answers(response_id);
CREATE INDEX forms.idx_forms_answers_question ON answers(question_id);
