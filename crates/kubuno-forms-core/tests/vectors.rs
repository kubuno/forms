//! Runs the conformance vectors of `vectors/` against the Rust core. The web client runs the same files
//! (`frontend/src/logic.vectors.test.ts`).

use kubuno_forms_core::{
    check_answer, compute_hidden, evaluate_operator, reached_questions, resolve_jump, validate_submission, AnswerInput,
    Answers, DisplayMode, QuestionSpec, Rule,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

fn field<T: DeserializeOwned + Default>(input: &Value, key: &str) -> T {
    match input.get(key) {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("input.{key}: {e}")),
        None => T::default(),
    }
}

fn questions(input: &Value) -> Vec<QuestionSpec> {
    field(input, "questions")
}

fn rules(input: &Value) -> Vec<Rule> {
    field(input, "rules")
}

fn answers(input: &Value) -> Answers {
    field(input, "answers")
}

fn mode(input: &Value) -> DisplayMode {
    DisplayMode::from_settings(input.get("settings").unwrap_or(&Value::Null))
}

fn path(name: &str) -> String {
    format!("{}/vectors/{name}", env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn operators() {
    kubuno_vectors::assert_suite(path("operators.json"), |input| {
        let op = input["operator"].as_str().unwrap_or_default();
        json!(evaluate_operator(op, input.get("answer"), input.get("compare").unwrap_or(&Value::Null)))
    });
}

#[test]
fn hidden() {
    kubuno_vectors::assert_suite(path("hidden.json"), |input| {
        json!(compute_hidden(&questions(input), &rules(input), &answers(input)))
    });
}

#[test]
fn jump() {
    kubuno_vectors::assert_suite(path("jump.json"), |input| {
        let id = input["question_id"].as_str().unwrap_or_default();
        json!(resolve_jump(id, &rules(input), &answers(input)))
    });
}

#[test]
fn reached() {
    kubuno_vectors::assert_suite(path("reached.json"), |input| {
        let qs = questions(input);
        let ids: Vec<&str> =
            reached_questions(&qs, &rules(input), &answers(input), mode(input)).iter().map(|q| q.id.as_str()).collect();
        json!(ids)
    });
}

#[test]
fn answer() {
    kubuno_vectors::assert_suite(path("answer.json"), |input| {
        let q: QuestionSpec = field(input, "question");
        json!(check_answer(&q, input.get("value")))
    });
}

#[test]
fn submission() {
    kubuno_vectors::assert_suite(path("submission.json"), |input| {
        let submitted: Vec<AnswerInput> = field(input, "answers");
        json!(validate_submission(&questions(input), &rules(input), mode(input), &submitted))
    });
}
