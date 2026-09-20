-- Replaces the retired Google typeface with the platform's own face, Outfit.
-- The theme column DEFAULT was already declared as Outfit in 000001 (SQLite
-- cannot ALTER a column default), so only the data rewrite remains. PostgreSQL's
-- `theme ? 'fontFamily'` becomes `json_extract(...) IS NOT NULL`, `theme->>'k'`
-- becomes json_extract, and jsonb_set becomes json_set. On a fresh install these
-- UPDATEs match no rows, but they carry the same correction.

-- The form-wide family.
UPDATE forms.forms
   SET theme = json_set(theme, '$.fontFamily', 'Outfit, Arial, sans-serif')
 WHERE json_extract(theme, '$.fontFamily') IS NOT NULL
   AND json_extract(theme, '$.fontFamily') LIKE '%Google Sans%';

-- The per-block text styles, which store a bare family name.
UPDATE forms.forms
   SET theme = json_set(theme, '$.headerText.font', 'Outfit')
 WHERE json_extract(theme, '$.headerText.font') LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = json_set(theme, '$.questionText.font', 'Outfit')
 WHERE json_extract(theme, '$.questionText.font') LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = json_set(theme, '$.bodyText.font', 'Outfit')
 WHERE json_extract(theme, '$.bodyText.font') LIKE 'Google Sans%';
