-- Restores the previous default. Stored themes are not put back (see the
-- PostgreSQL migration for the reasoning).
ALTER TABLE forms.forms ALTER COLUMN theme SET DEFAULT ('{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Google Sans, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}');
