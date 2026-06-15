// Publier des events vers le core via pg_notify serait fait ici.
// Pour l'instant, les events sont loggés localement.
use uuid::Uuid;

pub fn publish_form_created(form_id: Uuid, owner_id: Uuid) {
    tracing::info!(form_id = %form_id, owner_id = %owner_id, "FormCreated");
}

pub fn publish_response_received(form_id: Uuid, response_id: Uuid) {
    tracing::info!(form_id = %form_id, response_id = %response_id, "FormResponseReceived");
}
