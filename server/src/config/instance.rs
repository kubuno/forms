//! Instance-wide settings of the forms module, as the administrator left them in
//! the console.
//!
//! Declared by `module.toml`'s `[[settings]]`, stored in `core.settings`, and read
//! back through `/internal/modules/forms/settings`. Until this existed the module
//! only ever read its STATIC deploy config (`state.settings.forms.*`), so admin
//! edits were inert; every value an administrator can change now flows through
//! here instead.
//!
//! Every field here is read by code that acts on it.

use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub struct InstanceConfig {
    /// Maximum number of questions a single form may hold.
    pub max_questions: i64,
    /// Maximum size, in megabytes, of a file uploaded through a form.
    pub max_file_upload_mb: i64,
    /// Days a response is kept before the retention worker purges it. `0` = keep
    /// forever.
    pub response_retention_days: i64,
    /// Minimum seconds between two submissions from the same IP (anti-spam).
    pub submission_cooldown_secs: i64,
}

impl Default for InstanceConfig {
    fn default() -> Self {
        Self {
            max_questions:           200,
            max_file_upload_mb:      10,
            response_retention_days: 0,
            submission_cooldown_secs: 30,
        }
    }
}

impl InstanceConfig {
    /// Maps the core's `{key: value}` object onto the struct. Every read falls
    /// back to the compiled default rather than to a permissive value; an
    /// out-of-range number is ignored the same way. `0` is meaningful for
    /// retention (keep forever), so it is accepted there.
    pub fn from_settings(settings: &Value) -> Self {
        let d = Self::default();
        let int_in = |key: &str, min: i64, max: i64, fallback: i64| -> i64 {
            settings
                .get(key)
                .and_then(Value::as_i64)
                .filter(|n| (min..=max).contains(n))
                .unwrap_or(fallback)
        };
        Self {
            max_questions:            int_in("max_questions", 1, 100_000, d.max_questions),
            max_file_upload_mb:       int_in("max_file_upload_mb", 1, 10_240, d.max_file_upload_mb),
            response_retention_days:  int_in("response_retention_days", 0, 3650, d.response_retention_days),
            submission_cooldown_secs: int_in("submission_cooldown_secs", 0, 86_400, d.submission_cooldown_secs),
        }
    }
}

/// Reads the instance settings from the core. Any failure yields `None`, so the
/// caller keeps the values it already had rather than reverting to defaults
/// because the core was briefly unreachable.
pub async fn fetch(http: &reqwest::Client, core_url: &str, secret: &str) -> Option<InstanceConfig> {
    let url = format!("{core_url}/internal/modules/forms/settings");
    let resp = http
        .get(&url)
        .header("X-Internal-Secret", secret)
        .send()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Lecture des réglages d'instance forms"))
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Réglages d'instance forms refusés par le core");
        return None;
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Réglages d'instance forms : réponse illisible"))
        .ok()?;

    Some(InstanceConfig::from_settings(body.get("settings")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_keep_the_compiled_defaults() {
        let c = InstanceConfig::from_settings(&json!({}));
        assert_eq!(c.max_questions, 200);
        assert_eq!(c.max_file_upload_mb, 10);
        assert_eq!(c.response_retention_days, 0);
        assert_eq!(c.submission_cooldown_secs, 30);
    }

    #[test]
    fn values_are_read_and_clamped() {
        let c = InstanceConfig::from_settings(&json!({
            "max_questions": 50, "response_retention_days": 90, "submission_cooldown_secs": 0,
        }));
        assert_eq!(c.max_questions, 50);
        assert_eq!(c.response_retention_days, 90);
        assert_eq!(c.submission_cooldown_secs, 0);
    }
}
