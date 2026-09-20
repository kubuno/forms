-- Forms v2. On SQLite the widened question_type column and the enlarged
-- question_type / operator / action CHECK sets were already declared at their
-- final values in 000001 and 000003 (SQLite cannot ALTER a CHECK), so only the
-- uploads table is created here.
CREATE TABLE IF NOT EXISTS forms.uploads (
    id           BLOB    NOT NULL PRIMARY KEY,
    form_id      BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    question_id  BLOB    REFERENCES questions(id) ON DELETE SET NULL,
    file_name    TEXT    NOT NULL,
    content_type TEXT,
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    storage_path TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS forms.idx_forms_uploads_form ON uploads(form_id);
