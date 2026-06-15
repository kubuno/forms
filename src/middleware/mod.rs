use axum::{extract::{Request, State}, middleware::Next, response::Response};
use uuid::Uuid;
use crate::{errors::FormsError, state::AppState};

#[derive(Debug, Clone)]
pub struct FormsUser {
    pub id:    Uuid,
    pub role:  String,
    pub email: String,
}

pub type FormsUserExt = axum::Extension<FormsUser>;

pub async fn require_auth(
    State(_state): State<AppState>,
    mut req: Request,
    next: Next,
) -> std::result::Result<Response, FormsError> {
    let user_id = req
        .headers()
        .get("x-kubuno-user-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(FormsError::Unauthorized)?;

    let role = req
        .headers()
        .get("x-kubuno-user-role")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("user")
        .to_string();

    let email = req
        .headers()
        .get("x-kubuno-user-email")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    req.extensions_mut().insert(FormsUser { id: user_id, role, email });
    Ok(next.run(req).await)
}
