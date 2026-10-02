use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum FormsError {
    #[error("Non authentifié")]
    Unauthorized,

    #[error("Accès refusé")]
    Forbidden,

    #[error("Ressource introuvable: {0}")]
    NotFound(String),

    #[error("Données invalides: {0}")]
    Validation(String),

    /// A refused form submission: the message names the first question at fault, `issues` lists every
    /// question id with its stable code (kubuno-forms-core `IssueCode`).
    #[error("Données invalides: {message}")]
    Submission { message: String, issues: serde_json::Value },

    #[error("Conflit: {0}")]
    Conflict(String),

    #[error("Trop de requêtes — réessayez dans quelques instants")]
    TooManyRequests,

    #[error("Formulaire fermé ou expiré")]
    FormClosed,

    /// The form only accepts respondents signed in to an account.
    #[error("Connexion requise pour répondre à ce formulaire")]
    SignInRequired,

    /// The form accepts one response per account and this account already answered.
    #[error("Vous avez déjà répondu à ce formulaire")]
    AlreadyResponded,

    #[error("Erreur base de données")]
    Database(#[from] sqlx::Error),

    #[error("Erreur interne")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for FormsError {
    fn into_response(self) -> Response {
        if let FormsError::Submission { issues, .. } = &self {
            let body = json!({ "error": "VALIDATION", "message": self.to_string(), "issues": issues });
            return (StatusCode::UNPROCESSABLE_ENTITY, Json(body)).into_response();
        }
        let (status, code, message) = match &self {
            FormsError::Unauthorized      => (StatusCode::UNAUTHORIZED,          "UNAUTHORIZED",    self.to_string()),
            FormsError::Forbidden         => (StatusCode::FORBIDDEN,             "FORBIDDEN",       self.to_string()),
            FormsError::NotFound(_)       => (StatusCode::NOT_FOUND,             "NOT_FOUND",       self.to_string()),
            FormsError::Validation(_) | FormsError::Submission { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION", self.to_string()),
            FormsError::Conflict(_)       => (StatusCode::CONFLICT,              "CONFLICT",        self.to_string()),
            FormsError::TooManyRequests   => (StatusCode::TOO_MANY_REQUESTS,     "TOO_MANY_REQUESTS", self.to_string()),
            FormsError::FormClosed        => (StatusCode::GONE,                  "FORM_CLOSED",     self.to_string()),
            FormsError::SignInRequired    => (StatusCode::UNAUTHORIZED,          "SIGN_IN_REQUIRED", self.to_string()),
            FormsError::AlreadyResponded  => (StatusCode::CONFLICT,              "ALREADY_RESPONDED", self.to_string()),
            FormsError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Erreur base de données".to_string())
            }
            FormsError::Internal(e) => {
                tracing::error!(error = %e, "Internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erreur interne".to_string())
            }
        };
        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, FormsError>;
