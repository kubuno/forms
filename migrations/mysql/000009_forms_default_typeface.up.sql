-- Replaces the retired Google typeface with the platform's own face, Outfit.
-- The `theme ? 'fontFamily'` key-existence operator of PostgreSQL becomes
-- JSON_CONTAINS_PATH; `theme->>'k'` becomes JSON_UNQUOTE(JSON_EXTRACT(...)); and
-- jsonb_set becomes JSON_SET. On a fresh install these UPDATEs match no rows,
-- but they carry the same correction the PostgreSQL migration does.

ALTER TABLE forms.forms ALTER COLUMN theme SET DEFAULT ('{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Outfit, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}');

-- The form-wide family.
UPDATE forms.forms
   SET theme = JSON_SET(theme, '$.fontFamily', 'Outfit, Arial, sans-serif')
 WHERE JSON_CONTAINS_PATH(theme, 'one', '$.fontFamily')
   AND JSON_UNQUOTE(JSON_EXTRACT(theme, '$.fontFamily')) LIKE '%Google Sans%';

-- The per-block text styles, which store a bare family name.
UPDATE forms.forms
   SET theme = JSON_SET(theme, '$.headerText.font', 'Outfit')
 WHERE JSON_UNQUOTE(JSON_EXTRACT(theme, '$.headerText.font')) LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = JSON_SET(theme, '$.questionText.font', 'Outfit')
 WHERE JSON_UNQUOTE(JSON_EXTRACT(theme, '$.questionText.font')) LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = JSON_SET(theme, '$.bodyText.font', 'Outfit')
 WHERE JSON_UNQUOTE(JSON_EXTRACT(theme, '$.bodyText.font')) LIKE 'Google Sans%';
