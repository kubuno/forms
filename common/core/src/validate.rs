//! Validation of a submission: which answers count, which required questions are missing, and whether each
//! answer has the shape and range its question type allows. The server runs [`validate_submission`] on every
//! submission; the public page runs the same rules (`frontend/src/logic.ts`) before sending.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::js;
use crate::logic::{is_content_type, is_empty_value, reached_questions, Answers, DisplayMode, QuestionSpec, Rule};

/// Longest accepted text answer, in characters (`short_text`, a field of a group or an address line).
pub const MAX_SHORT_TEXT: usize = 10_000;
/// Longest accepted `long_text` answer, in characters.
pub const MAX_LONG_TEXT: usize = 100_000;
/// Longest accepted e-mail address or URL, in characters.
pub const MAX_LINK: usize = 2_048;
/// Longest accepted signature (a `data:image/png;base64,` URL), in characters.
pub const MAX_SIGNATURE: usize = 2_000_000;
/// Longest accepted phone number, in characters.
pub const MAX_PHONE: usize = 32;
/// Longest accepted short attribute (phone label, country code, file id), in characters.
pub const MAX_ATTRIBUTE: usize = 200;

/// Why an answer or a submission is refused. Codes are stable: they are part of the vectors and of the API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCode {
    /// A required question the respondent reached has no answer.
    Required,
    /// The value has the wrong JSON type for the question.
    InvalidType,
    /// A choice that is not one of the question's options (or rows/columns of a grid).
    InvalidChoice,
    /// A number, scale or rating outside its range.
    OutOfRange,
    /// A text longer than allowed.
    TooLong,
    /// An e-mail, URL, phone, date, time or signature that is not well formed.
    InvalidFormat,
    /// The same question answered twice in one submission.
    DuplicateAnswer,
}

/// One problem of a submission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub question_id: String,
    pub code: IssueCode,
}

/// One submitted answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnswerInput {
    pub question_id: String,
    pub value: Value,
}

/// The verdict on a submission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Verdict {
    /// Problems, in form order; empty when the submission is accepted.
    pub issues: Vec<Issue>,
    /// Ids of the answers to store, in submission order: answers to questions the respondent reached that collect
    /// an answer and are not blank.
    pub accepted: Vec<String>,
    /// Ids of the answers that are dropped, sorted: unknown questions, content blocks, questions the respondent
    /// did not reach (hidden or jumped over), blank values.
    pub ignored: Vec<String>,
}

impl Verdict {
    pub fn is_ok(&self) -> bool {
        self.issues.is_empty()
    }
}

/// The verdict on one answer value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnswerVerdict {
    pub answered: bool,
    pub issue: Option<IssueCode>,
}

fn option_ids(options: &Value, key: &str) -> Vec<String> {
    options
        .get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|o| o.get("id").and_then(Value::as_str).map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn group_keys(options: &Value) -> Vec<String> {
    options
        .get("fields")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|f| f.get("key").and_then(Value::as_str).map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn option_number(options: &Value, key: &str, default: f64) -> f64 {
    match options.get(key) {
        Some(Value::Number(n)) => js::json_number(n),
        _ => default,
    }
}

fn non_blank_str(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::String(s)) if !js::trim(s).is_empty())
}

fn any_non_blank_field(v: &Value) -> bool {
    v.as_object().is_some_and(|o| o.values().any(|x| non_blank_str(Some(x)) || matches!(x, Value::Number(_))))
}

/// `true` when the value counts as an answer for this question type (what "required" checks).
pub fn is_answered(question_type: &str, value: Option<&Value>) -> bool {
    if is_content_type(question_type) {
        return false;
    }
    let Some(v) = value else { return false };
    match question_type {
        "phone" => match v {
            Value::Object(o) => non_blank_str(o.get("number")),
            other => !is_empty_value(Some(other)),
        },
        "birthday" => match v {
            Value::Object(o) => ["day", "month", "year"].iter().any(|k| {
                let f = o.get(*k);
                non_blank_str(f) || matches!(f, Some(Value::Number(_)))
            }),
            other => !is_empty_value(Some(other)),
        },
        "address" | "field_group" => match v {
            Value::Object(_) => any_non_blank_field(v),
            other => !is_empty_value(Some(other)),
        },
        "grid_radio" | "grid_checkbox" => match v {
            Value::Object(o) => o.values().any(|x| !is_empty_value(Some(x))),
            other => !is_empty_value(Some(other)),
        },
        "file_upload" => match v {
            Value::Object(o) => non_blank_str(o.get("fileId")),
            other => !is_empty_value(Some(other)),
        },
        _ => !is_empty_value(Some(v)),
    }
}

fn chars(s: &str) -> usize {
    s.chars().count()
}

fn text(v: &Value, max: usize) -> Result<(), IssueCode> {
    match v {
        Value::String(s) if chars(s) > max => Err(IssueCode::TooLong),
        Value::String(_) => Ok(()),
        _ => Err(IssueCode::InvalidType),
    }
}

/// The browser's definition of a valid e-mail address (HTML, `input type=email`).
pub fn is_valid_email(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else { return false };
    let local_ok = !local.is_empty() && local.chars().all(|c| c.is_ascii_alphanumeric() || ".!#$%&'*+/=?^_`{|}~-".contains(c));
    let domain_ok = !domain.is_empty()
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        });
    local_ok && domain_ok
}

/// An absolute URL: a scheme, a colon, then something, without whitespace or control characters.
pub fn is_valid_url(s: &str) -> bool {
    let Some((scheme, rest)) = s.split_once(':') else { return false };
    let mut sc = scheme.chars();
    matches!(sc.next(), Some(c) if c.is_ascii_alphabetic())
        && sc.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
        && !rest.is_empty()
        && !s.chars().any(|c| js::is_js_whitespace(c) || c.is_control())
}

fn is_valid_phone_number(s: &str) -> bool {
    let digits = s.chars().filter(char::is_ascii_digit).count();
    digits >= 3 && s.chars().all(|c| c.is_ascii_digit() || " +-().,/".contains(c))
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(m: i64, year: Option<i64>) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => match year {
            Some(y) if !is_leap(y) => 28,
            _ => 29,
        },
        _ => 0,
    }
}

fn digits_value(s: &str, max_len: usize) -> Option<i64> {
    (!s.is_empty() && s.len() <= max_len && s.chars().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

/// `YYYY-MM-DD`, a real calendar day.
pub fn is_valid_date(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    match (digits_value(parts[0], 4), digits_value(parts[1], 2), digits_value(parts[2], 2)) {
        (Some(y), Some(m), Some(d)) => (1..=12).contains(&m) && d >= 1 && d <= days_in_month(m, Some(y)),
        _ => false,
    }
}

/// `H:MM` or `HH:MM`, optional `:SS`, optional ` AM`/`PM` (12-hour clock).
pub fn is_valid_time(s: &str) -> bool {
    let upper = s.to_ascii_uppercase();
    let (clock, twelve) = match upper.strip_suffix("AM").or_else(|| upper.strip_suffix("PM")) {
        Some(c) => (c.trim_end_matches(js::is_js_whitespace).to_owned(), true),
        None => (upper.clone(), false),
    };
    let parts: Vec<&str> = clock.split(':').collect();
    if !(2..=3).contains(&parts.len()) || parts[0].is_empty() || parts[0].len() > 2 {
        return false;
    }
    let Some(h) = digits_value(parts[0], 2) else { return false };
    let minutes_ok = parts[1..].iter().all(|p| p.len() == 2 && digits_value(p, 2).is_some_and(|v| v <= 59));
    let hour_ok = if twelve { (1..=12).contains(&h) } else { h <= 23 };
    minutes_ok && hour_ok
}

fn date_part(v: Option<&Value>) -> Result<Option<i64>, IssueCode> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if js::trim(s).is_empty() => Ok(None),
        Some(Value::String(s)) => digits_value(js::trim(s), 4).map(Some).ok_or(IssueCode::InvalidFormat),
        Some(Value::Number(n)) => {
            let f = js::json_number(n);
            if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e15 {
                Ok(Some(f as i64))
            } else {
                Err(IssueCode::InvalidFormat)
            }
        }
        Some(_) => Err(IssueCode::InvalidType),
    }
}

/// The most serious of several problems found in an object's entries, so that the verdict never depends on the
/// order in which a platform iterates object keys.
fn worst(found: &[IssueCode]) -> Result<(), IssueCode> {
    for code in [IssueCode::InvalidType, IssueCode::InvalidChoice, IssueCode::TooLong] {
        if found.contains(&code) {
            return Err(code);
        }
    }
    Ok(())
}

fn string_fields(o: &Map<String, Value>, allowed: Option<&[String]>, max: usize) -> Result<(), IssueCode> {
    if o.len() > 50 {
        return Err(IssueCode::TooLong);
    }
    let mut found = Vec::new();
    for (k, v) in o {
        if let Some(keys) = allowed {
            if !keys.iter().any(|x| x == k) {
                found.push(IssueCode::InvalidChoice);
            }
        }
        match v {
            Value::Null => {}
            Value::String(s) if chars(s) > max => found.push(IssueCode::TooLong),
            Value::String(_) => {}
            _ => found.push(IssueCode::InvalidType),
        }
    }
    worst(&found)
}

fn integer_in(v: &Value, min: f64, max: f64) -> Result<(), IssueCode> {
    let n = match v {
        Value::Number(n) => js::json_number(n),
        _ => return Err(IssueCode::InvalidType),
    };
    if n.fract() != 0.0 || n < min || n > max {
        return Err(IssueCode::OutOfRange);
    }
    Ok(())
}

/// Checks the shape and range of a value that [`is_answered`] accepted. Unknown question types accept any value.
pub fn check_value(question: &QuestionSpec, value: &Value) -> Result<(), IssueCode> {
    let o = &question.options;
    match question.question_type.as_str() {
        "short_text" => text(value, MAX_SHORT_TEXT),
        "long_text" => text(value, MAX_LONG_TEXT),
        "email" => {
            text(value, MAX_LINK)?;
            let s = value.as_str().map(js::trim).unwrap_or_default();
            if is_valid_email(s) { Ok(()) } else { Err(IssueCode::InvalidFormat) }
        }
        "url" => {
            text(value, MAX_LINK)?;
            let s = value.as_str().map(js::trim).unwrap_or_default();
            if is_valid_url(s) { Ok(()) } else { Err(IssueCode::InvalidFormat) }
        }
        "number" => match value {
            Value::Number(n) if js::json_number(n).is_finite() => Ok(()),
            Value::String(s) if js::string_to_number(s).is_some_and(f64::is_finite) => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidFormat),
            _ => Err(IssueCode::InvalidType),
        },
        "phone" => {
            let (number, extra) = match value {
                Value::String(s) => (s.as_str(), None),
                Value::Object(m) => match m.get("number") {
                    Some(Value::String(s)) => (s.as_str(), Some(m)),
                    _ => return Err(IssueCode::InvalidType),
                },
                _ => return Err(IssueCode::InvalidType),
            };
            if let Some(m) = extra {
                for key in ["country", "label"] {
                    match m.get(key) {
                        None | Some(Value::Null) => {}
                        Some(Value::String(s)) if chars(s) > MAX_ATTRIBUTE => return Err(IssueCode::TooLong),
                        Some(Value::String(_)) => {}
                        Some(_) => return Err(IssueCode::InvalidType),
                    }
                }
            }
            let n = js::trim(number);
            if chars(n) > MAX_PHONE {
                return Err(IssueCode::TooLong);
            }
            if is_valid_phone_number(n) { Ok(()) } else { Err(IssueCode::InvalidFormat) }
        }
        "multiple_choice" | "dropdown" => match value {
            Value::String(s) if option_ids(o, "options").iter().any(|id| id == s) => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidChoice),
            _ => Err(IssueCode::InvalidType),
        },
        "checkbox" | "ranking" => {
            let Value::Array(items) = value else { return Err(IssueCode::InvalidType) };
            let ids = option_ids(o, "options");
            let mut seen = HashSet::new();
            for item in items {
                let Value::String(s) = item else { return Err(IssueCode::InvalidType) };
                if !ids.iter().any(|id| id == s) || !seen.insert(s.as_str()) {
                    return Err(IssueCode::InvalidChoice);
                }
            }
            Ok(())
        }
        "yes_no" => match value {
            Value::String(s) if s == "yes" || s == "no" => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidChoice),
            _ => Err(IssueCode::InvalidType),
        },
        "linear_scale" => integer_in(value, option_number(o, "min", 1.0), option_number(o, "max", 5.0)),
        "opinion_scale" => integer_in(value, option_number(o, "min", 0.0), option_number(o, "max", 10.0)),
        "rating" => integer_in(value, 1.0, option_number(o, "max", 5.0)),
        "date" => match value {
            Value::String(s) if is_valid_date(js::trim(s)) => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidFormat),
            _ => Err(IssueCode::InvalidType),
        },
        "time" => match value {
            Value::String(s) if is_valid_time(js::trim(s)) => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidFormat),
            _ => Err(IssueCode::InvalidType),
        },
        "birthday" => {
            let Value::Object(m) = value else { return Err(IssueCode::InvalidType) };
            if let Some(Value::String(s)) = m.get("label") {
                if chars(s) > MAX_ATTRIBUTE {
                    return Err(IssueCode::TooLong);
                }
            }
            let day = date_part(m.get("day"))?;
            let month = date_part(m.get("month"))?;
            let year = date_part(m.get("year"))?;
            match (day, month) {
                (Some(d), Some(mo)) => {
                    if let Some(y) = year {
                        if !(1000..=9999).contains(&y) {
                            return Err(IssueCode::OutOfRange);
                        }
                    }
                    if (1..=12).contains(&mo) && d >= 1 && d <= days_in_month(mo, year) {
                        Ok(())
                    } else {
                        Err(IssueCode::InvalidFormat)
                    }
                }
                _ => Err(IssueCode::InvalidFormat),
            }
        }
        "address" => match value {
            Value::Object(m) => string_fields(m, None, MAX_SHORT_TEXT),
            _ => Err(IssueCode::InvalidType),
        },
        "field_group" => match value {
            Value::Object(m) => {
                let keys = group_keys(o);
                string_fields(m, if keys.is_empty() { None } else { Some(&keys) }, MAX_SHORT_TEXT)
            }
            _ => Err(IssueCode::InvalidType),
        },
        "grid_radio" | "grid_checkbox" => {
            let Value::Object(m) = value else { return Err(IssueCode::InvalidType) };
            let rows = option_ids(o, "rows");
            let cols = option_ids(o, "columns");
            let multi = question.question_type == "grid_checkbox";
            let mut found = Vec::new();
            for (row, cell) in m {
                if !rows.iter().any(|r| r == row) {
                    found.push(IssueCode::InvalidChoice);
                }
                let picked: Vec<&Value> = match (cell, multi) {
                    (Value::Null, _) => Vec::new(),
                    (Value::String(_), false) => vec![cell],
                    (Value::Array(a), true) => a.iter().collect(),
                    _ => {
                        found.push(IssueCode::InvalidType);
                        Vec::new()
                    }
                };
                let mut seen = HashSet::new();
                for c in picked {
                    match c {
                        Value::String(s) if cols.iter().any(|x| x == s) && seen.insert(s.as_str()) => {}
                        Value::String(_) => found.push(IssueCode::InvalidChoice),
                        _ => found.push(IssueCode::InvalidType),
                    }
                }
            }
            worst(&found)
        }
        "file_upload" => {
            let Value::Object(m) = value else { return Err(IssueCode::InvalidType) };
            match m.get("fileId") {
                Some(Value::String(s)) if chars(s) <= MAX_ATTRIBUTE => Ok(()),
                Some(Value::String(_)) => Err(IssueCode::TooLong),
                _ => Err(IssueCode::InvalidType),
            }
        }
        "signature" => match value {
            Value::String(s) if chars(s) > MAX_SIGNATURE => Err(IssueCode::TooLong),
            Value::String(s) if s.starts_with("data:image/png;base64,") => Ok(()),
            Value::String(_) => Err(IssueCode::InvalidFormat),
            _ => Err(IssueCode::InvalidType),
        },
        _ => Ok(()),
    }
}

/// The verdict on one value for one question: whether it counts as answered and, if so, whether it is valid.
pub fn check_answer(question: &QuestionSpec, value: Option<&Value>) -> AnswerVerdict {
    let answered = is_answered(&question.question_type, value);
    let issue = match value {
        Some(v) if answered => check_value(question, v).err(),
        _ => None,
    };
    AnswerVerdict { answered, issue }
}

/// Validates a whole submission against the form: answers to questions the respondent reached are checked, every
/// required question reached must be answered, everything else is ignored (not stored).
pub fn validate_submission(
    questions: &[QuestionSpec],
    rules: &[Rule],
    mode: DisplayMode,
    answers: &[AnswerInput],
) -> Verdict {
    let mut issues = Vec::new();
    let mut map = Answers::new();
    let mut duplicates = BTreeSet::new();
    for a in answers {
        if map.insert(a.question_id.clone(), a.value.clone()).is_some() {
            duplicates.insert(a.question_id.clone());
        }
    }
    let by_id: HashMap<&str, &QuestionSpec> = questions.iter().map(|q| (q.id.as_str(), q)).collect();
    let reached: HashSet<&str> = reached_questions(questions, rules, &map, mode).iter().map(|q| q.id.as_str()).collect();

    let order: HashMap<&str, usize> = questions.iter().enumerate().map(|(i, q)| (q.id.as_str(), i)).collect();
    for q in questions {
        if !reached.contains(q.id.as_str()) || is_content_type(&q.question_type) {
            continue;
        }
        if duplicates.contains(&q.id) {
            issues.push(Issue { question_id: q.id.clone(), code: IssueCode::DuplicateAnswer });
            continue;
        }
        let verdict = check_answer(q, map.get(&q.id));
        if let Some(code) = verdict.issue {
            issues.push(Issue { question_id: q.id.clone(), code });
        } else if q.required && !verdict.answered {
            issues.push(Issue { question_id: q.id.clone(), code: IssueCode::Required });
        }
    }
    issues.sort_by_key(|i| order.get(i.question_id.as_str()).copied().unwrap_or(usize::MAX));

    let mut accepted = Vec::new();
    let mut ignored = BTreeSet::new();
    let mut taken = HashSet::new();
    for a in answers {
        let keep = by_id.get(a.question_id.as_str()).is_some_and(|q| {
            !is_content_type(&q.question_type)
                && reached.contains(q.id.as_str())
                && is_answered(&q.question_type, Some(&a.value))
        });
        if keep && taken.insert(a.question_id.as_str()) {
            accepted.push(a.question_id.clone());
        } else if !keep {
            ignored.insert(a.question_id.clone());
        }
    }
    Verdict { issues, accepted, ignored: ignored.into_iter().collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn q(id: &str, t: &str, required: bool, options: Value) -> QuestionSpec {
        QuestionSpec { id: id.into(), question_type: t.into(), required, options, title: id.into() }
    }

    fn a(id: &str, v: Value) -> AnswerInput {
        AnswerInput { question_id: id.into(), value: v }
    }

    #[test]
    fn required_questions_must_be_answered_even_with_rules() {
        // The bypass of 2026-10-02: a form with a rule skipped the required check entirely.
        let qs = vec![q("name", "short_text", true, json!({})), q("ok", "yes_no", false, json!({}))];
        let rules = vec![Rule {
            trigger_question_id: "ok".into(),
            operator: "equals".into(),
            compare_value: json!("no"),
            action: "submit_form".into(),
            target_section_id: None,
            position: 0,
        }];
        let v = validate_submission(&qs, &rules, DisplayMode::Classic, &[a("ok", json!("yes"))]);
        assert_eq!(v.issues, [Issue { question_id: "name".into(), code: IssueCode::Required }]);
        let v = validate_submission(&qs, &rules, DisplayMode::Classic, &[a("name", json!("Ada")), a("ok", json!("yes"))]);
        assert!(v.is_ok());
    }

    #[test]
    fn hidden_and_unknown_answers_are_ignored() {
        let qs = vec![
            q("a", "yes_no", true, json!({})),
            q("s", "section", false, json!({})),
            q("b", "short_text", true, json!({})),
        ];
        let rules = vec![Rule {
            trigger_question_id: "a".into(),
            operator: "equals".into(),
            compare_value: json!("yes"),
            action: "show_section".into(),
            target_section_id: Some("s".into()),
            position: 0,
        }];
        let v = validate_submission(&qs, &rules, DisplayMode::Classic, &[a("a", json!("no")), a("b", json!(42)), a("zz", json!("x"))]);
        assert!(v.is_ok(), "{v:?}");
        assert_eq!(v.accepted, ["a"]);
        assert_eq!(v.ignored, ["b", "zz"]);
    }

    #[test]
    fn values_are_checked() {
        let choice = q("c", "multiple_choice", false, json!({ "options": [{ "id": "o1" }, { "id": "o2" }] }));
        assert_eq!(check_answer(&choice, Some(&json!("o3"))).issue, Some(IssueCode::InvalidChoice));
        assert_eq!(check_answer(&choice, Some(&json!("o2"))).issue, None);
        let scale = q("l", "linear_scale", false, json!({ "min": 1, "max": 5 }));
        assert_eq!(check_answer(&scale, Some(&json!(6))).issue, Some(IssueCode::OutOfRange));
        let email = q("e", "email", false, json!({}));
        assert_eq!(check_answer(&email, Some(&json!("not-an-email"))).issue, Some(IssueCode::InvalidFormat));
        assert_eq!(check_answer(&email, Some(&json!(" ada@example.org "))).issue, None);
        assert!(is_valid_time("9:05"));
        assert!(is_valid_time("12:30 PM"));
        assert!(!is_valid_time("24:00"));
        assert!(is_valid_date("2024-02-29"));
        assert!(!is_valid_date("2023-02-29"));
    }
}
