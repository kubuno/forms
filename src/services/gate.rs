//! Server-side policy of a form's public link: whether the form takes answers right now, and what a
//! respondent must provide (an account, an e-mail, a single response).
//!
//! These rules used to live in the editor and the public page only, so a response posted straight to the
//! API ignored them. Everything here is pure (settings and facts in, decision out) so that it can be tested
//! without a database; the handlers in `handlers::public` feed it.

use chrono::{DateTime, Utc};
use serde_json::Value;

/// Whether a form accepts answers through its public link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    Open,
    /// Never published, or unpublished by its owner.
    Unpublished,
    /// The owner switched "accepting responses" off.
    Closed,
    /// Past its closing date.
    Expired,
    /// The maximum number of responses is reached.
    Full,
}

impl Availability {
    /// The value reported by `GET /public/:token/status`.
    pub fn as_str(self) -> &'static str {
        match self {
            Availability::Open => "open",
            Availability::Unpublished => "unpublished",
            Availability::Closed => "closed",
            Availability::Expired => "expired",
            Availability::Full => "full",
        }
    }
}

/// Decides whether a form takes answers. `response_count` is the number of responses actually stored (counted,
/// not the cached counter, which depends on a database trigger).
pub fn availability(settings: &Value, published: bool, response_count: i64, now: DateTime<Utc>) -> Availability {
    if !published {
        return Availability::Unpublished;
    }
    if settings.get("acceptingResponses").and_then(Value::as_bool) == Some(false) {
        return Availability::Closed;
    }
    if let Some(close) = settings
        .get("closeDate")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<DateTime<Utc>>().ok())
    {
        if now > close {
            return Availability::Expired;
        }
    }
    if let Some(max) = settings.get("maxResponses").and_then(Value::as_i64) {
        if response_count >= max {
            return Availability::Full;
        }
    }
    Availability::Open
}

/// What a form asks of its respondents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RespondentPolicy {
    /// Only signed-in accounts may open and answer the form.
    pub require_sign_in: bool,
    /// The respondent's e-mail address is collected (and required).
    pub collect_email: bool,
    /// One response per account. Only meaningful with `require_sign_in` (an anonymous respondent has no
    /// identity to count), which is also how the editor offers it.
    pub one_response_per_account: bool,
}

impl RespondentPolicy {
    pub fn from_settings(settings: &Value) -> Self {
        let flag = |k: &str| settings.get(k).and_then(Value::as_bool).unwrap_or(false);
        let require_sign_in = flag("requireSignIn");
        RespondentPolicy {
            require_sign_in,
            collect_email: flag("collectEmail"),
            one_response_per_account: require_sign_in && flag("limitToOneResponse"),
        }
    }
}

/// Why a respondent e-mail was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailError {
    /// The form collects e-mails and none was given.
    Required,
    /// The given value is not an e-mail address.
    Invalid,
}

/// Longest accepted e-mail address (RFC 5321 path limit).
pub const MAX_EMAIL_LEN: usize = 254;

/// The e-mail to store with a response.
///
/// - A form that does not collect e-mails stores none, whatever the client sent.
/// - On a sign-in form the account's own address is stored (verified by the core), not a typed one.
/// - Otherwise the typed address is required and must be valid.
pub fn respondent_email(
    policy: &RespondentPolicy,
    account_email: Option<&str>,
    submitted: Option<&str>,
) -> Result<Option<String>, EmailError> {
    if !policy.collect_email {
        return Ok(None);
    }
    if policy.require_sign_in {
        if let Some(account) = account_email.map(str::trim).filter(|e| !e.is_empty()) {
            return Ok(Some(account.to_string()));
        }
    }
    let typed = submitted.map(str::trim).filter(|e| !e.is_empty()).ok_or(EmailError::Required)?;
    if typed.chars().count() > MAX_EMAIL_LEN || !kubuno_forms_core::validate::is_valid_email(typed) {
        return Err(EmailError::Invalid);
    }
    Ok(Some(typed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn now() -> DateTime<Utc> {
        "2026-10-02T12:00:00Z".parse().expect("date")
    }

    #[test]
    fn an_unpublished_form_takes_no_answers() {
        assert_eq!(availability(&json!({ "acceptingResponses": true }), false, 0, now()), Availability::Unpublished);
    }

    #[test]
    fn a_published_open_form_takes_answers() {
        assert_eq!(availability(&json!({}), true, 0, now()), Availability::Open);
        assert_eq!(availability(&json!({ "acceptingResponses": true, "closeDate": null }), true, 3, now()), Availability::Open);
    }

    #[test]
    fn closed_expired_and_full_forms_take_no_answers() {
        assert_eq!(availability(&json!({ "acceptingResponses": false }), true, 0, now()), Availability::Closed);
        assert_eq!(
            availability(&json!({ "closeDate": "2026-10-01T00:00:00Z" }), true, 0, now()),
            Availability::Expired
        );
        assert_eq!(
            availability(&json!({ "closeDate": "2026-10-03T00:00:00.000Z" }), true, 0, now()),
            Availability::Open
        );
        assert_eq!(availability(&json!({ "maxResponses": 2 }), true, 2, now()), Availability::Full);
        assert_eq!(availability(&json!({ "maxResponses": 2 }), true, 1, now()), Availability::Open);
        assert_eq!(availability(&json!({ "maxResponses": 0 }), true, 0, now()), Availability::Full);
    }

    #[test]
    fn one_response_per_account_needs_sign_in() {
        let p = RespondentPolicy::from_settings(&json!({ "limitToOneResponse": true }));
        assert!(!p.one_response_per_account);
        let p = RespondentPolicy::from_settings(&json!({ "limitToOneResponse": true, "requireSignIn": true }));
        assert!(p.require_sign_in && p.one_response_per_account);
    }

    #[test]
    fn email_is_dropped_when_not_collected() {
        let p = RespondentPolicy::default();
        assert_eq!(respondent_email(&p, None, Some("x@example.org")), Ok(None));
        assert_eq!(respondent_email(&p, None, Some("not an email")), Ok(None));
    }

    #[test]
    fn email_is_required_and_checked_when_collected() {
        let p = RespondentPolicy { collect_email: true, ..Default::default() };
        assert_eq!(respondent_email(&p, None, None), Err(EmailError::Required));
        assert_eq!(respondent_email(&p, None, Some("   ")), Err(EmailError::Required));
        assert_eq!(respondent_email(&p, None, Some("nope")), Err(EmailError::Invalid));
        let long = format!("{}@example.org", "a".repeat(250));
        assert_eq!(respondent_email(&p, None, Some(&long)), Err(EmailError::Invalid));
        assert_eq!(respondent_email(&p, None, Some(" ada@example.org ")), Ok(Some("ada@example.org".into())));
        // Without the sign-in requirement, a signed-in visitor's account address is not imposed.
        assert_eq!(respondent_email(&p, Some("acct@example.org"), Some("ada@example.org")), Ok(Some("ada@example.org".into())));
    }

    #[test]
    fn sign_in_forms_store_the_account_address() {
        let p = RespondentPolicy { collect_email: true, require_sign_in: true, ..Default::default() };
        assert_eq!(
            respondent_email(&p, Some("acct@example.org"), Some("someone-else@example.org")),
            Ok(Some("acct@example.org".into()))
        );
        assert_eq!(respondent_email(&p, Some("acct@example.org"), None), Ok(Some("acct@example.org".into())));
    }
}
