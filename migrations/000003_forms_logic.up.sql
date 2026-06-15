-- ── Logique conditionnelle ────────────────────────────────────────────────────

CREATE TABLE forms.conditional_rules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id             UUID NOT NULL REFERENCES forms.forms(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    trigger_question_id UUID NOT NULL REFERENCES forms.questions(id) ON DELETE CASCADE,
    operator            VARCHAR(20) NOT NULL
                            CHECK (operator IN (
                                'equals', 'not_equals', 'contains',
                                'greater_than', 'less_than', 'is_empty', 'is_not_empty'
                            )),
    compare_value       JSONB,
    action              VARCHAR(20) NOT NULL
                            CHECK (action IN (
                                'show_section', 'hide_section', 'go_to_section', 'submit_form'
                            )),
    target_section_id   UUID REFERENCES forms.questions(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forms_rules_form    ON forms.conditional_rules(form_id, position);
CREATE INDEX idx_forms_rules_trigger ON forms.conditional_rules(trigger_question_id);
