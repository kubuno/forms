// Forms does not publish on the instance bus yet; these only trace locally.
// When it does, it will go through the core's internal HTTP endpoint
// (`POST /internal/events/publish`) — the transport the other modules use, and
// the one that assumes nothing about the database engine underneath. Not a
// PostgreSQL NOTIFY: only one of the three supported engines can perform one.
use uuid::Uuid;

pub fn publish_form_created(form_id: Uuid, owner_id: Uuid) {
    tracing::info!(form_id = %form_id, owner_id = %owner_id, "FormCreated");
}

pub fn publish_response_received(form_id: Uuid, response_id: Uuid) {
    tracing::info!(form_id = %form_id, response_id = %response_id, "FormResponseReceived");
}
