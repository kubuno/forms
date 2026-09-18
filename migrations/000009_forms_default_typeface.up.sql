-- Replaces the retired Google typeface with the platform's own face, Outfit.
--
-- Two distinct things have to change, and editing 000001 would fix neither on a
-- running instance (an applied migration is frozen):
--
--   * the column DEFAULT, which every form created from now on inherits;
--   * the rows already written, which carry the old family inside their JSON
--     theme and would keep asking for a font the instance no longer ships —
--     silently falling back to Arial.
--
-- Only the font family is touched: the themes are rewritten through `jsonb_set`,
-- so every other key an operator or a user has set is preserved.

ALTER TABLE forms.forms ALTER COLUMN theme SET DEFAULT '{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Outfit, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}';

-- The form-wide family.
UPDATE forms.forms
   SET theme = jsonb_set(theme, '{fontFamily}', '"Outfit, Arial, sans-serif"')
 WHERE theme ? 'fontFamily'
   AND theme->>'fontFamily' LIKE '%Google Sans%';

-- The per-block text styles, which store a bare family name. Written as three
-- separate statements ON PURPOSE: PostgreSQL applies at most ONE update per row
-- per statement, so folding these into a single `UPDATE … FROM (VALUES …)`
-- would silently fix only one of the three styles on any form that uses all of
-- them.
UPDATE forms.forms
   SET theme = jsonb_set(theme, '{headerText,font}', '"Outfit"')
 WHERE theme->'headerText'->>'font' LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = jsonb_set(theme, '{questionText,font}', '"Outfit"')
 WHERE theme->'questionText'->>'font' LIKE 'Google Sans%';

UPDATE forms.forms
   SET theme = jsonb_set(theme, '{bodyText,font}', '"Outfit"')
 WHERE theme->'bodyText'->>'font' LIKE 'Google Sans%';
