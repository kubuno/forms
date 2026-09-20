-- ── Forms v2 : new question types, richer conditional logic, file uploads ──────

-- Widen the column (longest new type is 'thank_you_screen' = 16 chars; safe headroom)
ALTER TABLE forms.questions ALTER COLUMN question_type TYPE VARCHAR(40);

-- Relax the question_type CHECK to allow the new Typeform-style field types
ALTER TABLE forms.questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE forms.questions ADD CONSTRAINT questions_question_type_check
    CHECK (question_type IN (
        'short_text', 'long_text', 'multiple_choice', 'checkbox',
        'dropdown', 'linear_scale', 'rating', 'date', 'time',
        'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section',
        -- v2 additions
        'yes_no', 'email', 'number', 'phone', 'url', 'opinion_scale',
        'ranking', 'statement', 'welcome_screen', 'thank_you_screen', 'signature'
    ));

-- Extend the conditional logic operators and actions
ALTER TABLE forms.conditional_rules DROP CONSTRAINT IF EXISTS conditional_rules_operator_check;
ALTER TABLE forms.conditional_rules ADD CONSTRAINT conditional_rules_operator_check
    CHECK (operator IN (
        'equals', 'not_equals', 'contains', 'not_contains',
        'starts_with', 'ends_with',
        'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
        'is_empty', 'is_not_empty'
    ));

ALTER TABLE forms.conditional_rules DROP CONSTRAINT IF EXISTS conditional_rules_action_check;
ALTER TABLE forms.conditional_rules ADD CONSTRAINT conditional_rules_action_check
    CHECK (action IN (
        'show_section', 'hide_section', 'go_to_section', 'skip_to_question',
        'jump_to_thankyou', 'submit_form'
    ));

-- File uploads collected from public submissions (one row per uploaded file)
CREATE TABLE IF NOT EXISTS forms.uploads (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id      UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    question_id  UUID REFERENCES forms.questions(id) ON DELETE SET NULL,
    file_name    TEXT NOT NULL,
    content_type TEXT,
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_uploads_form ON forms.uploads(form_id);
