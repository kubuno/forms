-- Oracle MySQL variant of migrations/mysql/000009_forms_default_typeface.down.sql: runs instead of it on
-- Oracle MySQL only and is recorded under its checksum (kubuno_db::MySqlVariants).
-- MySQL refuses `ALTER COLUMN ... SET DEFAULT (expr)` on a JSON column (error 1101)
-- but accepts the same expression default through MODIFY COLUMN.
-- Restores the previous default. Stored themes are not put back (see the
-- PostgreSQL migration for the reasoning).
ALTER TABLE forms.forms MODIFY COLUMN theme JSON NOT NULL DEFAULT ('{
    "primaryColor":    "#673ab7",
    "headerColor":     "#673ab7",
    "fontFamily":      "Google Sans, Arial, sans-serif",
    "backgroundImage": null,
    "style":           "default"
}');
