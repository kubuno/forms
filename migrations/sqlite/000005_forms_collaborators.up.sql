-- User-to-user sharing (mirrors office's document_collaborators).
CREATE TABLE IF NOT EXISTS forms.form_collaborators (
    form_id    BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id    BLOB    NOT NULL,
    permission TEXT    NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
    added_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (form_id, user_id)
);

CREATE INDEX IF NOT EXISTS forms.idx_forms_collab_user ON form_collaborators(user_id);
