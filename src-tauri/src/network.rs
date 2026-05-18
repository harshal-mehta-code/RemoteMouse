use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    routing::get,
    Router,
};
use enigo::{MouseButton as EnigoButton, Key};
use local_ip_address::list_afinet_netifas;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::auth::AppState;
use crate::mouse_controller::{EnigoController, MouseController};

// ---------------------------------------------------------------------------
// Inter-thread message type
// ---------------------------------------------------------------------------

/// Messages sent from async WebSocket handlers to the blocking Enigo worker.
#[derive(Clone)]
pub enum InputEvent {
    MouseMove(i32, i32),
    MouseClick(EnigoButton, bool),
    MouseDown(EnigoButton),
    MouseUp(EnigoButton),
    MouseScroll(i32),
    KeyboardType(String),
    KeyboardTap(Key),
}

// ---------------------------------------------------------------------------
// IP discovery
// ---------------------------------------------------------------------------

/// Return the first non-loopback LAN IPv4 address, falling back to loopback.
pub fn get_ip_address() -> String {
    let network_interfaces = list_afinet_netifas().unwrap_or_default();
    for (_name, ip) in network_interfaces {
        if ip.is_ipv4() && !ip.is_loopback() {
            let ip_str = ip.to_string();
            if ip_str.starts_with("192.168.") || ip_str.starts_with("10.") {
                return ip_str;
            }
        }
    }
    "127.0.0.1".to_string()
}

// ---------------------------------------------------------------------------
// Enigo worker thread
// ---------------------------------------------------------------------------

/// Spawn a dedicated OS thread that owns the `EnigoController` and processes
/// [`InputEvent`]s from the returned channel sender.
///
/// Enigo is not `Send` + `Sync`, so it must live on its own thread.
pub fn start_input_worker() -> Sender<InputEvent> {
    let (tx, rx) = channel::<InputEvent>();
    std::thread::spawn(move || {
        let mut controller = EnigoController::new();
        while let Ok(event) = rx.recv() {
            dispatch_event(&mut controller, event);
        }
    });
    tx
}

/// Forward an [`InputEvent`] to the [`MouseController`].
fn dispatch_event(controller: &mut dyn MouseController, event: InputEvent) {
    match event {
        InputEvent::MouseMove(dx, dy) => controller.mouse_move(dx, dy),
        InputEvent::MouseClick(btn, double) => controller.mouse_click(btn, double),
        InputEvent::MouseDown(btn) => controller.mouse_down(btn),
        InputEvent::MouseUp(btn) => controller.mouse_up(btn),
        InputEvent::MouseScroll(dy) => controller.mouse_scroll(dy),
        InputEvent::KeyboardType(text) => controller.keyboard_type(&text),
        InputEvent::KeyboardTap(key) => controller.keyboard_tap(key),
    }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

/// Handle one WebSocket connection: authenticate, then route events.
async fn handle_socket(
    mut socket: WebSocket,
    tx: Sender<InputEvent>,
    state: Arc<AppState>,
    client_id: String,
) {
    println!("New WebSocket connection: {}", client_id);
    let mut authenticated = false;

    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                let event = val["event"].as_str().unwrap_or("");
                let data = &val["data"];

                // --- auth gate ---
                if !authenticated {
                    if event == "auth" {
                        let provided_pin = data["pin"].as_str().unwrap_or("");
                        if provided_pin == state.pin {
                            authenticated = true;
                            state
                                .authenticated_clients
                                .lock()
                                .unwrap()
                                .insert(client_id.clone());
                            println!("Client authenticated: {}", client_id);
                            let _ = socket
                                .send(Message::Text(
                                    serde_json::json!({ "event": "auth_success" }).to_string(),
                                ))
                                .await;
                        } else {
                            let _ = socket
                                .send(Message::Text(
                                    serde_json::json!({
                                        "event": "auth_error",
                                        "data": { "message": "Invalid PIN" }
                                    })
                                    .to_string(),
                                ))
                                .await;
                        }
                    }
                    continue;
                }

                // --- event routing ---
                route_event(event, data, &tx);
            }
        }
    }
}

/// Parse a validated JSON event and enqueue the corresponding [`InputEvent`].
fn route_event(event: &str, data: &serde_json::Value, tx: &Sender<InputEvent>) {
    match event {
        "mouseMove" | "mouseDrag" => {
            let dx = data["dx"].as_f64().unwrap_or(0.0) as i32;
            let dy = data["dy"].as_f64().unwrap_or(0.0) as i32;
            let _ = tx.send(InputEvent::MouseMove(dx, dy));
        }
        "mouseClick" => {
            let button = data["button"].as_str().unwrap_or("left");
            let is_double = data["double"].as_bool().unwrap_or(false);
            let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
            let _ = tx.send(InputEvent::MouseClick(enigo_button, is_double));
        }
        "mouseDown" => {
            let button = data["button"].as_str().unwrap_or("left");
            let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
            let _ = tx.send(InputEvent::MouseDown(enigo_button));
        }
        "mouseUp" => {
            let button = data["button"].as_str().unwrap_or("left");
            let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
            let _ = tx.send(InputEvent::MouseUp(enigo_button));
        }
        "mouseScroll" => {
            let dy = data["deltaY"].as_f64().unwrap_or(0.0) as i32;
            let _ = tx.send(InputEvent::MouseScroll(-dy / 10));
        }
        "keyboardType" => {
            if let Some(text) = data["text"].as_str() {
                let _ = tx.send(InputEvent::KeyboardType(text.to_string()));
            }
        }
        "keyboardTap" => {
            if let Some(key_name) = data["key"].as_str() {
                let key = match key_name.to_lowercase().as_str() {
                    "backspace" => Some(Key::Backspace),
                    "enter" => Some(Key::Return),
                    "tab" => Some(Key::Tab),
                    "escape" => Some(Key::Escape),
                    _ => None,
                };
                if let Some(k) = key {
                    let _ = tx.send(InputEvent::KeyboardTap(k));
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Axum HTTP + WebSocket server
// ---------------------------------------------------------------------------

/// Start the Axum server (HTTP file serving + `/ws` WebSocket endpoint).
///
/// This is intended to be called inside a `std::thread::spawn` block with its
/// own `tokio::runtime::Runtime`, keeping async I/O off the Tauri main thread.
pub async fn run_server(
    state: Arc<AppState>,
    tx: Sender<InputEvent>,
    public_path: PathBuf,
) {
    let app = Router::new()
        .route(
            "/ws",
            get(move |ws: WebSocketUpgrade| {
                let tx = tx.clone();
                let s = state.clone();
                async move {
                    ws.on_upgrade(move |socket| {
                        let id = uuid::Uuid::new_v4().to_string();
                        handle_socket(socket, tx, s, id)
                    })
                }
            }),
        )
        .fallback_service(ServeDir::new(public_path));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3005").await.unwrap();
    println!("WebSocket server listening on :3005");
    axum::serve(listener, app).await.unwrap();
}
