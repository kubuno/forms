use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ConditionalRule {
    pub id:                  Uuid,
    pub form_id:             Uuid,
    pub position:            i32,
    pub trigger_question_id: Uuid,
    pub operator:            String,
    pub compare_value:       Option<Value>,
    pub action:              String,
    pub target_section_id:   Option<Uuid>,
    pub created_at:          DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateRuleDto {
    pub trigger_question_id: Uuid,
    pub operator:            String,
    pub compare_value:       Option<Value>,
    pub action:              String,
    pub target_section_id:   Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateRuleDto {
    pub operator:          Option<String>,
    pub compare_value:     Option<Value>,
    pub action:            Option<String>,
    pub target_section_id: Option<Value>,
}
