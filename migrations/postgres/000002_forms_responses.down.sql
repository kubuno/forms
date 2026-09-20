DROP TABLE IF EXISTS forms.answers;
DROP TRIGGER IF EXISTS responses_count ON forms.responses;
DROP FUNCTION IF EXISTS forms.update_response_count();
DROP TABLE IF EXISTS forms.responses;
