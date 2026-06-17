//! Quiz scoring: decide whether a submitted answer matches the question's
//! expected answer(s) and compute the points earned. Pure functions, unit-tested.

use serde_json::Value;

use crate::models::form::Question;

/// Outcome of grading a single answer.
pub struct Graded {
    pub is_correct:    bool,
    pub points_earned: i32,
}

/// True when a question participates in quiz scoring.
pub fn is_scorable(q: &Question) -> bool {
    q.points > 0
        && q.correct_answers
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
}

/// Grade a single answer value against a question's `correct_answers`.
pub fn grade(q: &Question, value: &Value) -> Graded {
    if !is_scorable(q) {
        return Graded { is_correct: false, points_earned: 0 };
    }
    let correct = q.correct_answers.as_array().cloned().unwrap_or_default();
    let is_correct = match q.question_type.as_str() {
        // Multiple correct values must match the selected set exactly (order-insensitive).
        "checkbox" => {
            let selected = value.as_array().cloned().unwrap_or_default();
            let mut sel: Vec<String> = selected.iter().map(value_to_key).collect();
            let mut exp: Vec<String> = correct.iter().map(value_to_key).collect();
            sel.sort();
            exp.sort();
            !sel.is_empty() && sel == exp
        }
        // Single-choice / scalar: any of the accepted values matches.
        _ => correct.iter().any(|c| values_match(c, value)),
    };
    Graded {
        is_correct,
        points_earned: if is_correct { q.points } else { 0 },
    }
}

/// Loose equality between an expected and a submitted value.
fn values_match(expected: &Value, actual: &Value) -> bool {
    // Numbers compare numerically regardless of JSON representation.
    if let (Some(a), Some(b)) = (as_number(expected), as_number(actual)) {
        return (a - b).abs() < f64::EPSILON;
    }
    // Otherwise compare normalised strings (trim + case-insensitive).
    value_to_key(expected) == value_to_key(actual)
}

fn as_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// Normalise a value to a comparable key (lower-cased, trimmed for strings).
fn value_to_key(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_lowercase(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    fn q(qtype: &str, points: i32, correct: Value) -> Question {
        Question {
            id: Uuid::new_v4(),
            form_id: Uuid::new_v4(),
            position: 0,
            question_type: qtype.into(),
            title: "Q".into(),
            description: None,
            required: false,
            image_path: None,
            options: json!({}),
            points,
            correct_answers: correct,
            feedback_correct: None,
            feedback_incorrect: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn not_scorable_without_points_or_answers() {
        assert!(!is_scorable(&q("short_text", 0, json!(["a"]))));
        assert!(!is_scorable(&q("short_text", 5, json!([]))));
        assert!(is_scorable(&q("short_text", 5, json!(["a"]))));
    }

    #[test]
    fn single_choice_grading() {
        let question = q("multiple_choice", 10, json!(["opt2"]));
        assert_eq!(grade(&question, &json!("opt2")).points_earned, 10);
        assert!(grade(&question, &json!("opt2")).is_correct);
        assert_eq!(grade(&question, &json!("opt1")).points_earned, 0);
    }

    #[test]
    fn text_grading_is_case_insensitive() {
        let question = q("short_text", 3, json!(["Paris"]));
        assert!(grade(&question, &json!("  paris ")).is_correct);
        assert!(!grade(&question, &json!("Lyon")).is_correct);
    }

    #[test]
    fn numeric_grading() {
        let question = q("number", 2, json!([42]));
        assert!(grade(&question, &json!(42)).is_correct);
        assert!(grade(&question, &json!("42")).is_correct);
        assert!(!grade(&question, &json!(7)).is_correct);
    }

    #[test]
    fn checkbox_requires_exact_set() {
        let question = q("checkbox", 4, json!(["a", "c"]));
        assert!(grade(&question, &json!(["c", "a"])).is_correct);
        assert!(!grade(&question, &json!(["a"])).is_correct);
        assert!(!grade(&question, &json!(["a", "b", "c"])).is_correct);
        assert!(!grade(&question, &json!([])).is_correct);
    }
}
