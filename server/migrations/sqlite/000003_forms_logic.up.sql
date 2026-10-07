-- Conditional logic. The operator / action CHECK sets are declared at their
-- FINAL values (PG reaches them in 000004).
CREATE TABLE forms.conditional_rules (
    id                  BLOB    NOT NULL PRIMARY KEY,
    form_id             BLOB    NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    trigger_question_id BLOB    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    operator            TEXT    NOT NULL CHECK (operator IN (
                            'equals', 'not_equals', 'contains', 'not_contains',
                            'starts_with', 'ends_with',
                            'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
                            'is_empty', 'is_not_empty'
                        )),
    compare_value       TEXT,
    action              TEXT    NOT NULL CHECK (action IN (
                            'show_section', 'hide_section', 'go_to_section', 'skip_to_question',
                            'jump_to_thankyou', 'submit_form'
                        )),
    target_section_id   BLOB    REFERENCES questions(id) ON DELETE SET NULL,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX forms.idx_forms_rules_form    ON conditional_rules(form_id, position);
CREATE INDEX forms.idx_forms_rules_trigger ON conditional_rules(trigger_question_id);
