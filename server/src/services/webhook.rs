use serde_json::Value;

pub fn fire_webhook(url: String, payload: Value) {
    tokio::spawn(async move {
        let _ = reqwest::Client::new()
            .post(&url)
            .json(&payload)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
    });
}
