use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct FormResponse {
    pub id:                 Uuid,
    pub form_id:            Uuid,
    pub respondent_id:      Option<Uuid>,
    pub respondent_email:   Option<String>,
    pub respondent_name:    Option<String>,
    pub fill_duration_secs: Option<i32>,
    pub score:              Option<i32>,
    pub max_score:          Option<i32>,
    pub source:             String,
    pub submitted_at:       DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Answer {
    pub id:           Uuid,
    pub response_id:  Uuid,
    pub question_id:  Uuid,
    pub value:        Value,
    pub is_correct:   Option<bool>,
    pub points_earned: i32,
    pub created_at:   DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnswerInput {
    pub question_id: Uuid,
    pub value:       Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubmitFormDto {
    pub answers:           Vec<AnswerInput>,
    pub respondent_email:  Option<String>,
    pub respondent_name:   Option<String>,
    pub fill_duration_secs: Option<i32>,
}
