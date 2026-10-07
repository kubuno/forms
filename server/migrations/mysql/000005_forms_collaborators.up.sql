-- User-to-user sharing (mirrors office's document_collaborators).
CREATE TABLE IF NOT EXISTS forms.form_collaborators (
    form_id    BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'view',
    added_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (form_id, user_id),
    CONSTRAINT form_collaborators_permission_check CHECK (permission IN ('view', 'edit')),
    CONSTRAINT fk_form_collaborators_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    INDEX idx_forms_collab_user (user_id)
);
