DROP TABLE IF EXISTS forms.uploads;

ALTER TABLE forms.conditional_rules DROP CONSTRAINT IF EXISTS conditional_rules_action_check;
ALTER TABLE forms.conditional_rules ADD CONSTRAINT conditional_rules_action_check
    CHECK (action IN ('show_section', 'hide_section', 'go_to_section', 'submit_form'));

ALTER TABLE forms.conditional_rules DROP CONSTRAINT IF EXISTS conditional_rules_operator_check;
ALTER TABLE forms.conditional_rules ADD CONSTRAINT conditional_rules_operator_check
    CHECK (operator IN (
        'equals', 'not_equals', 'contains',
        'greater_than', 'less_than', 'is_empty', 'is_not_empty'
    ));

ALTER TABLE forms.questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE forms.questions ADD CONSTRAINT questions_question_type_check
    CHECK (question_type IN (
        'short_text', 'long_text', 'multiple_choice', 'checkbox',
        'dropdown', 'linear_scale', 'rating', 'date', 'time',
        'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section'
    ));
ALTER TABLE forms.questions ALTER COLUMN question_type TYPE VARCHAR(30);
