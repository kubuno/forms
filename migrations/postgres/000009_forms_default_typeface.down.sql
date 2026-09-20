-- Restores the previous default. The stored themes are NOT put back: they were
-- migrated to a family the instance actually ships, and reverting them would
-- point live forms at a font that is no longer installed.
ALTER TABLE forms.forms ALTER COLUMN theme SET DEFAULT '{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Google Sans, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}';
