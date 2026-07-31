-- User-to-user sharing of a form: the owner grants view/edit access to other
-- Kubuno users. Mirrors office's document_collaborators so the two behave alike.
CREATE TABLE IF NOT EXISTS forms.form_collaborators (
    form_id    UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'view'
                   CHECK (permission IN ('view', 'edit')),
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (form_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forms_collab_user ON forms.form_collaborators(user_id);
