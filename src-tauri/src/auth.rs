use std::sync::Mutex;
use std::collections::HashSet;

/// Shared application state passed to every WebSocket handler.
pub struct AppState {
    /// The 4-digit pairing PIN generated at startup.
    pub pin: String,
    /// IDs of currently authenticated WebSocket clients.
    pub authenticated_clients: Mutex<HashSet<String>>,
}

impl AppState {
    pub fn new(pin: String) -> Self {
        Self {
            pin,
            authenticated_clients: Mutex::new(HashSet::new()),
        }
    }
}

/// Generate a zero-padded 4-digit PIN, e.g. "0042".
pub fn generate_pin() -> String {
    format!("{:04}", rand::random_range(0..10000))
}
