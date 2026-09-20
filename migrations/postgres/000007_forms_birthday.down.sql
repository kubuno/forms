ALTER TABLE forms.questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE forms.questions ADD CONSTRAINT questions_question_type_check
    CHECK (question_type IN (
        'short_text', 'long_text', 'multiple_choice', 'checkbox',
        'dropdown', 'linear_scale', 'rating', 'date', 'time',
        'file_upload', 'image', 'video', 'grid_radio', 'grid_checkbox', 'section',
        'yes_no', 'email', 'number', 'phone', 'url', 'opinion_scale',
        'ranking', 'statement', 'welcome_screen', 'thank_you_screen', 'signature',
        'field_group'
    ));
