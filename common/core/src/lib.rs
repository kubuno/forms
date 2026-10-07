//! Kubuno Forms shared core (lot SC-3b of vskubuno `docs/SHARED-CORES.md`).
//!
//! Sans-IO: questions, rules and answers in, verdicts out. No network, database, file system, clock or UI.
//!
//! - [`logic`]: the twelve rule operators, hidden questions (`show_section` / `hide_section`), jumps
//!   (`go_to_section`, `skip_to_question`, `jump_to_thankyou`, `submit_form`) and the questions a respondent
//!   reached in each display mode;
//! - [`validate`]: what counts as an answer per question type, the shape and range of each value, and the verdict
//!   on a whole submission (required questions over the reached set).
//!
//! The server validates every submission with [`validate_submission`]. The public page implements the same
//! functions in TypeScript (`frontend/src/logic.ts`); the JSON vectors in `vectors/` are run by both (Rust:
//! `tests/vectors.rs`, TypeScript: `frontend/src/logic.vectors.test.ts`), so any divergence fails a test.
#![forbid(unsafe_code)]

pub mod js;
pub mod logic;
pub mod validate;

pub use logic::{
    compute_hidden, evaluate_operator, is_content_type, reached_questions, resolve_jump, rule_matches, Answers,
    DisplayMode, Jump, QuestionSpec, Rule,
};
pub use validate::{
    check_answer, check_value, is_answered, validate_submission, AnswerInput, AnswerVerdict, Issue, IssueCode, Verdict,
};
