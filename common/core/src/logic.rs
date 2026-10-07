//! Conditional logic of a form: rule operators, hidden questions, jumps and the questions a respondent actually
//! reached. The web client implements the same functions in `frontend/src/logic.ts`; both run the vectors of
//! `vectors/`.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::js;

/// The answers of a submission, by question id.
pub type Answers = Map<String, Value>;

/// What the logic needs to know about a question.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct QuestionSpec {
    pub id: String,
    pub question_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Value,
    /// Plain or rich-text title, used only in error messages.
    #[serde(default)]
    pub title: String,
}

/// A conditional rule, as stored (`forms.conditional_rules`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub trigger_question_id: String,
    pub operator: String,
    #[serde(default)]
    pub compare_value: Value,
    pub action: String,
    #[serde(default)]
    pub target_section_id: Option<String>,
    #[serde(default)]
    pub position: i64,
}

/// How the public page presents the form (`settings.displayMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayMode {
    /// One question per screen; jump rules apply (the default).
    OneAtATime,
    /// Every visible question on one page, or one page per section; jump rules do not apply.
    Classic,
}

impl DisplayMode {
    /// Reads `settings.displayMode` as the public page does: absent or `null` means one at a time, any value other
    /// than `"one_at_a_time"` means the classic shell.
    pub fn from_settings(settings: &Value) -> Self {
        match settings.get("displayMode") {
            None | Some(Value::Null) => DisplayMode::OneAtATime,
            Some(Value::String(s)) if s == "one_at_a_time" => DisplayMode::OneAtATime,
            Some(_) => DisplayMode::Classic,
        }
    }
}

/// Question types that collect no answer.
pub const CONTENT_TYPES: [&str; 6] = ["image", "video", "statement", "section", "welcome_screen", "thank_you_screen"];

/// `true` when a question of this type collects no answer.
pub fn is_content_type(question_type: &str) -> bool {
    CONTENT_TYPES.contains(&question_type)
}

fn to_num(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => Some(js::json_number(n)),
        Some(Value::String(s)) if !js::trim(s).is_empty() => js::string_to_number(s),
        _ => None,
    }
}

fn to_str(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Array(a)) => js::join(a),
        Some(other) => js::to_js_string(other),
    }
}

/// JavaScript emptiness of an answer value: absent, `null`, a blank string or an empty array.
pub fn is_empty_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => js::trim(s).is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        Some(_) => false,
    }
}

fn array_has(answer: &[Value], compare: &Value) -> bool {
    let wanted = js::to_js_string(compare);
    answer.iter().any(|v| js::to_js_string(v) == wanted)
}

/// Evaluates one operator against an answer value (`None` = not answered) and the rule's compare value.
/// An unknown operator never matches.
pub fn evaluate_operator(operator: &str, answer: Option<&Value>, compare: &Value) -> bool {
    let cmp = || to_str(Some(compare)).to_lowercase();
    let ans = || to_str(answer).to_lowercase();
    let nums = || (to_num(answer), to_num(Some(compare)));
    match operator {
        "is_empty" => is_empty_value(answer),
        "is_not_empty" => !is_empty_value(answer),
        "equals" => match answer {
            Some(Value::Array(a)) => array_has(a, compare),
            _ => ans() == cmp(),
        },
        "not_equals" => !evaluate_operator("equals", answer, compare),
        "contains" => match answer {
            Some(Value::Array(a)) => array_has(a, compare),
            _ => ans().contains(&cmp()),
        },
        "not_contains" => !evaluate_operator("contains", answer, compare),
        "starts_with" => ans().starts_with(&cmp()),
        "ends_with" => ans().ends_with(&cmp()),
        "greater_than" => matches!(nums(), (Some(a), Some(b)) if a > b),
        "greater_or_equal" => matches!(nums(), (Some(a), Some(b)) if a >= b),
        "less_than" => matches!(nums(), (Some(a), Some(b)) if a < b),
        "less_or_equal" => matches!(nums(), (Some(a), Some(b)) if a <= b),
        _ => false,
    }
}

/// `true` when the rule's condition holds for these answers.
pub fn rule_matches(rule: &Rule, answers: &Answers) -> bool {
    evaluate_operator(&rule.operator, answers.get(&rule.trigger_question_id), &rule.compare_value)
}

fn target(rule: &Rule) -> Option<&str> {
    rule.target_section_id.as_deref().filter(|s| !s.is_empty())
}

/// The question ids a rule target controls: a section controls itself and every question up to the next section;
/// any other question controls only itself; an unknown target controls nothing.
fn range_of<'a>(questions: &'a [QuestionSpec], index: &HashMap<&str, usize>, target: Option<&str>) -> Vec<&'a str> {
    let Some(start) = target.and_then(|t| index.get(t).copied()) else {
        return Vec::new();
    };
    if questions[start].question_type != "section" {
        return vec![questions[start].id.as_str()];
    }
    let mut ids = Vec::new();
    for (i, q) in questions.iter().enumerate().skip(start) {
        if i > start && q.question_type == "section" {
            break;
        }
        ids.push(q.id.as_str());
    }
    ids
}

/// The hidden question ids: `show_section` targets start hidden and appear when one of their rules matches;
/// `hide_section` targets are hidden when their rule matches. Rules apply in the given order.
pub fn compute_hidden(questions: &[QuestionSpec], rules: &[Rule], answers: &Answers) -> BTreeSet<String> {
    let index: HashMap<&str, usize> = questions.iter().enumerate().map(|(i, q)| (q.id.as_str(), i)).collect();
    let mut hidden: HashSet<&str> = HashSet::new();
    for r in rules.iter().filter(|r| r.action == "show_section") {
        hidden.extend(range_of(questions, &index, target(r)));
    }
    for r in rules {
        if !rule_matches(r, answers) {
            continue;
        }
        if r.action == "show_section" {
            for id in range_of(questions, &index, target(r)) {
                hidden.remove(id);
            }
        }
        if r.action == "hide_section" {
            hidden.extend(range_of(questions, &index, target(r)));
        }
    }
    hidden.into_iter().map(str::to_owned).collect()
}

/// Where the one-at-a-time flow goes after a question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Jump {
    Goto { target_id: String },
    Thankyou,
    Submit,
}

const JUMP_ACTIONS: [&str; 4] = ["go_to_section", "skip_to_question", "jump_to_thankyou", "submit_form"];

/// The first matching jump rule triggered by `question_id` (rules by position), or `None` to simply advance.
pub fn resolve_jump(question_id: &str, rules: &[Rule], answers: &Answers) -> Option<Jump> {
    let mut applicable: Vec<&Rule> = rules
        .iter()
        .filter(|r| r.trigger_question_id == question_id && JUMP_ACTIONS.contains(&r.action.as_str()))
        .collect();
    applicable.sort_by_key(|r| r.position);
    for r in applicable {
        if !rule_matches(r, answers) {
            continue;
        }
        if r.action == "submit_form" {
            return Some(Jump::Submit);
        }
        if r.action == "jump_to_thankyou" {
            return Some(Jump::Thankyou);
        }
        if let Some(t) = target(r) {
            return Some(Jump::Goto { target_id: t.to_owned() });
        }
    }
    None
}

/// The questions the respondent was shown, in order, given the final answers:
/// - classic shell: every question that is not hidden (welcome and thank-you screens excluded);
/// - one at a time: the path the flow takes from the first step, following jump rules, until it submits, runs out
///   of steps or would loop.
pub fn reached_questions<'a>(
    questions: &'a [QuestionSpec],
    rules: &[Rule],
    answers: &Answers,
    mode: DisplayMode,
) -> Vec<&'a QuestionSpec> {
    let hidden = compute_hidden(questions, rules, answers);
    match mode {
        DisplayMode::Classic => questions
            .iter()
            .filter(|q| !hidden.contains(&q.id) && q.question_type != "welcome_screen" && q.question_type != "thank_you_screen")
            .collect(),
        DisplayMode::OneAtATime => {
            let steps: Vec<(usize, &QuestionSpec)> = questions
                .iter()
                .enumerate()
                .filter(|(_, q)| {
                    !hidden.contains(&q.id)
                        && !matches!(q.question_type.as_str(), "section" | "welcome_screen" | "thank_you_screen")
                })
                .collect();
            let mut path = Vec::new();
            let mut seen = HashSet::new();
            let mut current = if steps.is_empty() { None } else { Some(0usize) };
            while let Some(step) = current {
                let (_, q) = steps[step];
                if !seen.insert(step) {
                    break;
                }
                path.push(q);
                current = match resolve_jump(&q.id, rules, answers) {
                    Some(Jump::Submit) | Some(Jump::Thankyou) => None,
                    Some(Jump::Goto { target_id }) => {
                        // The first step at or after the target in the form's order (an unknown target is
                        // position -1, i.e. the first step, exactly as the page computes it).
                        let target_pos = questions.iter().position(|x| x.id == target_id);
                        steps.iter().position(|(i, _)| target_pos.is_none_or(|t| *i >= t))
                    }
                    None => (step + 1 < steps.len()).then_some(step + 1),
                };
            }
            path
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn q(id: &str, t: &str) -> QuestionSpec {
        QuestionSpec { id: id.into(), question_type: t.into(), ..Default::default() }
    }

    fn rule(trigger: &str, op: &str, cmp: Value, action: &str, target: Option<&str>, position: i64) -> Rule {
        Rule {
            trigger_question_id: trigger.into(),
            operator: op.into(),
            compare_value: cmp,
            action: action.into(),
            target_section_id: target.map(Into::into),
            position,
        }
    }

    fn answers(v: Value) -> Answers {
        v.as_object().cloned().unwrap_or_default()
    }

    #[test]
    fn show_section_hides_its_range_until_matched() {
        let qs = vec![q("a", "yes_no"), q("s", "section"), q("b", "short_text"), q("s2", "section"), q("c", "short_text")];
        let rules = vec![rule("a", "equals", json!("yes"), "show_section", Some("s"), 0)];
        let hidden = compute_hidden(&qs, &rules, &answers(json!({})));
        assert_eq!(hidden.into_iter().collect::<Vec<_>>(), ["b", "s"]);
        assert!(compute_hidden(&qs, &rules, &answers(json!({ "a": "YES" }))).is_empty());
    }

    #[test]
    fn flow_follows_jumps_and_stops_on_loops() {
        let qs = vec![q("a", "yes_no"), q("b", "short_text"), q("s", "section"), q("c", "short_text")];
        let rules = vec![rule("a", "equals", json!("no"), "go_to_section", Some("s"), 0)];
        let ids = |a: Value| {
            reached_questions(&qs, &rules, &answers(a), DisplayMode::OneAtATime).iter().map(|q| q.id.clone()).collect::<Vec<_>>()
        };
        assert_eq!(ids(json!({ "a": "no" })), ["a", "c"]);
        assert_eq!(ids(json!({ "a": "yes" })), ["a", "b", "c"]);
        let looping = vec![rule("b", "is_empty", Value::Null, "go_to_section", Some("a"), 0)];
        let path = reached_questions(&qs, &looping, &answers(json!({})), DisplayMode::OneAtATime);
        assert_eq!(path.iter().map(|q| q.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    }

    #[test]
    fn display_mode_defaults_to_one_at_a_time() {
        assert_eq!(DisplayMode::from_settings(&json!({})), DisplayMode::OneAtATime);
        assert_eq!(DisplayMode::from_settings(&json!({ "displayMode": null })), DisplayMode::OneAtATime);
        assert_eq!(DisplayMode::from_settings(&json!({ "displayMode": "section" })), DisplayMode::Classic);
        assert_eq!(DisplayMode::from_settings(&json!({ "displayMode": "classic" })), DisplayMode::Classic);
    }
}
