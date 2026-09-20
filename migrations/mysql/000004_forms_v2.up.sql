-- Forms v2. On MySQL the widened question_type column and the enlarged
-- question_type / operator / action CHECK sets were already declared at their
-- final values in 000001 and 000003, so only the uploads table is created here.
CREATE TABLE IF NOT EXISTS forms.uploads (
    id           BINARY(16)  NOT NULL PRIMARY KEY,
    form_id      BINARY(16)  NOT NULL,
    question_id  BINARY(16)  NULL,
    file_name    TEXT        NOT NULL,
    content_type TEXT,
    size_bytes   BIGINT      NOT NULL DEFAULT 0,
    storage_path TEXT        NOT NULL,
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT fk_uploads_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    CONSTRAINT fk_uploads_question FOREIGN KEY (question_id)
        REFERENCES forms.questions(id) ON DELETE SET NULL,
    INDEX idx_forms_uploads_form (form_id)
);
