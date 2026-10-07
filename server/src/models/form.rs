use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Form {
    pub id:               Uuid,
    pub owner_id:         Uuid,
    pub title:            String,
    pub description:      Option<String>,
    pub theme:            Value,
    pub header_image_path: Option<String>,
    pub settings:         Value,
    pub public_token:     String,
    pub response_count:   i32,
    pub last_response_at: Option<DateTime<Utc>>,
    pub is_trashed:       bool,
    pub trashed_at:       Option<DateTime<Utc>>,
    pub published_at:     Option<DateTime<Utc>>,
    pub created_at:       DateTime<Utc>,
    pub updated_at:       DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct FormSummary {
    pub id:             Uuid,
    pub owner_id:       Uuid,
    pub title:          String,
    pub description:    Option<String>,
    pub theme:          Value,
    pub response_count: i32,
    pub last_response_at: Option<DateTime<Utc>>,
    pub is_trashed:     bool,
    pub published_at:   Option<DateTime<Utc>>,
    pub created_at:     DateTime<Utc>,
    pub updated_at:     DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFormDto {
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateFormDto {
    pub title:       Option<String>,
    pub description: Option<Value>,
    pub theme:       Option<Value>,
    pub settings:    Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Question {
    pub id:                 Uuid,
    pub form_id:            Uuid,
    pub position:           i32,
    pub question_type:      String,
    pub title:              String,
    pub description:        Option<String>,
    pub required:           bool,
    pub image_path:         Option<String>,
    pub options:            Value,
    pub points:             i32,
    pub correct_answers:    Value,
    pub feedback_correct:   Option<String>,
    pub feedback_incorrect: Option<String>,
    pub created_at:         DateTime<Utc>,
    pub updated_at:         DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateQuestionDto {
    pub question_type: Option<String>,
    pub title:         Option<String>,
    pub position:      Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateQuestionDto {
    pub question_type:      Option<String>,
    pub title:              Option<String>,
    pub description:        Option<Value>,
    pub required:           Option<bool>,
    pub options:            Option<Value>,
    pub points:             Option<i32>,
    pub correct_answers:    Option<Value>,
    pub feedback_correct:   Option<Value>,
    pub feedback_incorrect: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReorderItem {
    pub id:       Uuid,
    pub position: i32,
}
