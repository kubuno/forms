-- Conditional logic. The operator / action CHECK sets are declared at their
-- FINAL values (PG reaches them in 000004); compare_value is nullable JSON.
CREATE TABLE forms.conditional_rules (
    id                  BINARY(16)  NOT NULL PRIMARY KEY,
    form_id             BINARY(16)  NOT NULL,
    position            INT         NOT NULL DEFAULT 0,
    trigger_question_id BINARY(16)  NOT NULL,
    operator            VARCHAR(20) NOT NULL,
    compare_value       JSON        NULL,
    action              VARCHAR(20) NOT NULL,
    target_section_id   BINARY(16)  NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT conditional_rules_operator_check CHECK (operator IN (
        'equals', 'not_equals', 'contains', 'not_contains',
        'starts_with', 'ends_with',
        'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
        'is_empty', 'is_not_empty'
    )),
    CONSTRAINT conditional_rules_action_check CHECK (action IN (
        'show_section', 'hide_section', 'go_to_section', 'skip_to_question',
        'jump_to_thankyou', 'submit_form'
    )),
    CONSTRAINT fk_rules_form FOREIGN KEY (form_id)
        REFERENCES forms.forms(id) ON DELETE CASCADE,
    CONSTRAINT fk_rules_trigger FOREIGN KEY (trigger_question_id)
        REFERENCES forms.questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_rules_target FOREIGN KEY (target_section_id)
        REFERENCES forms.questions(id) ON DELETE SET NULL,
    INDEX idx_forms_rules_form    (form_id, position),
    INDEX idx_forms_rules_trigger (trigger_question_id)
);
