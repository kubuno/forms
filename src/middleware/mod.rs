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

/// This module's id, used as the token audience.
const MODULE_ID: &str = "forms";

/// Authenticate the caller from the signed `X-Kubuno-Auth` token the core mints
/// with this module's internal secret (see `kubuno-modauth`), instead of
/// trusting the plain `X-Kubuno-User-*` headers — which any process reaching this
/// module's loopback port could otherwise forge to impersonate any user.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> std::result::Result<Response, FormsError> {
    let token = req
        .headers()
        .get(kubuno_modauth::TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or(FormsError::Unauthorized)?;

    let user = kubuno_modauth::verify(
        state.settings.core.internal_secret.as_bytes(),
        token,
        MODULE_ID,
    )
    .map_err(|_| FormsError::Unauthorized)?;

    req.extensions_mut()
        .insert(FormsUser { id: user.id, role: user.role, email: user.email });
    Ok(next.run(req).await)
}

/// The caller of a PUBLIC route, when signed in: the core forwards the signed identity of a logged-in
/// visitor on every proxied request, public routes included. Absent or invalid → anonymous.
pub fn optional_user(state: &AppState, headers: &axum::http::HeaderMap) -> Option<FormsUser> {
    let token = headers.get(kubuno_modauth::TOKEN_HEADER)?.to_str().ok()?;
    let user = kubuno_modauth::verify(state.settings.core.internal_secret.as_bytes(), token, MODULE_ID).ok()?;
    Some(FormsUser { id: user.id, role: user.role, email: user.email })
}

/// The respondent's IP address. Behind the core every request comes from the loopback, so the address the core
/// resolved (`X-Kubuno-Client-IP`) is used — but only on a request that carries this module's secret, i.e. one
/// the core itself forwarded; anything else falls back to the TCP peer.
pub fn client_ip(state: &AppState, headers: &axum::http::HeaderMap, peer: std::net::IpAddr) -> std::net::IpAddr {
    let secret = state.settings.core.internal_secret.as_bytes();
    let from_core = !secret.is_empty()
        && headers
            .get("x-internal-secret")
            .is_some_and(|v| constant_time_eq(v.as_bytes(), secret));
    if !from_core {
        return peer;
    }
    headers
        .get("x-kubuno-client-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(peer)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn secret_comparison() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }
}
