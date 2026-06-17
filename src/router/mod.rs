use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    handlers::{analytics, export, forms, health, public, questions, responses, rules, uploads},
    middleware::require_auth,
    state::AppState,
};

pub fn build(state: AppState) -> Router {
    // Routes authentifiées (propriétaire du formulaire)
    let authed = Router::new()
        // Formulaires
        .route("/forms",                                      get(forms::list).post(forms::create))
        .route("/forms/:id",                                  get(forms::get).patch(forms::update))
        .route("/forms/:id/trash",                            post(forms::trash))
        .route("/forms/:id/restore",                          post(forms::restore))
        .route("/forms/:id/delete",                           delete(forms::delete))
        .route("/forms/:id/duplicate",                        post(forms::duplicate))
        .route("/forms/:id/publish",                          post(forms::publish))
        // Questions
        .route("/forms/:id/questions",                        get(questions::list).post(questions::create))
        .route("/forms/:id/questions/reorder",                patch(questions::reorder))
        .route("/forms/:id/questions/:qid",                   patch(questions::update).delete(questions::delete))
        .route("/forms/:id/questions/:qid/duplicate",         post(questions::duplicate))
        // Réponses
        .route("/forms/:id/responses",                        get(responses::list).delete(responses::delete_all))
        .route("/forms/:id/responses/:rid",                   get(responses::get).delete(responses::delete_one))
        .route("/forms/:id/responses/individual/:index",      get(responses::get_individual))
        // Statistiques
        .route("/forms/:id/analytics",                        get(analytics::global_stats))
        .route("/forms/:id/analytics/questions",              get(analytics::question_stats))
        // Export
        .route("/forms/:id/export/csv",                       get(export::csv))
        // Fichiers téléversés (téléchargement réservé au propriétaire)
        .route("/forms/:id/uploads/:file_id",                 get(uploads::download))
        // Logique conditionnelle
        .route("/forms/:id/rules",                            get(rules::list).post(rules::create))
        .route("/forms/:id/rules/:rid",                       patch(rules::update).delete(rules::delete))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth))
        .with_state(state.clone());

    // Routes publiques (répondants anonymes)
    let public_routes = Router::new()
        .route("/public/:token",        get(public::get_form))
        .route("/public/:token/submit", post(public::submit))
        .route("/public/:token/status", get(public::status))
        .route("/public/:token/upload", post(uploads::upload))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state.clone());

    // Health check
    let system = Router::new()
        .route("/health", get(health::health))
        .with_state(state);

    Router::new()
        .merge(system)
        .merge(public_routes)
        .nest("/", authed)
        .layer(DefaultBodyLimit::disable())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
