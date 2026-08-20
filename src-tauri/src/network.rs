use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    routing::get,
    Router,
};
use enigo::{Button as EnigoButton, Key};
use local_ip_address::list_afinet_netifas;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Instant;
use tower_http::services::ServeDir;

use crate::auth::{constant_time_eq, AppState, SESSION_IDLE};
use crate::mouse_controller::{EnigoController, MouseController, ZOOM_RELEASE_TIMEOUT};

/// Port the mobile client connects to.
pub const SERVER_PORT: u16 = 3005;
/// Maximum accepted WebSocket frame size. Mirrors `LIMITS.MAX_FRAME_BYTES`.
const MAX_FRAME_BYTES: usize = 4096;
/// Maximum characters accepted in a single `keyboardType` event.
const MAX_TEXT_LENGTH: usize = 256;
/// Maximum absolute value for any pointer delta, in pixels.
const MAX_DELTA: f64 = 5000.0;

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
    MouseScroll(f64),
    KeyboardType(String),
    KeyboardTap(Key, Vec<Key>),
    PinchZoom(f64),
    PinchEnd,
}

// ---------------------------------------------------------------------------
// IP discovery
// ---------------------------------------------------------------------------

/// True for RFC 1918 private ranges.
fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    matches!((a, b), (10, _) | (192, 168) | (172, 16..=31))
}

/// Return the LAN IPv4 address clients should connect to.
///
/// Prefers an RFC 1918 private address, then any other non-loopback IPv4.
/// Returns `None` when the host has no usable network interface, so callers can
/// surface that instead of advertising an unreachable URL.
pub fn get_ip_address() -> Option<String> {
    let interfaces = list_afinet_netifas().unwrap_or_default();
    let candidates: Vec<Ipv4Addr> = interfaces
        .into_iter()
        .filter_map(|(_name, ip)| match ip {
            IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => Some(v4),
            _ => None,
        })
        .collect();

    candidates
        .iter()
        .find(|ip| is_private_ipv4(ip))
        .or_else(|| candidates.first())
        .map(|ip| ip.to_string())
}

// ---------------------------------------------------------------------------
// Enigo worker thread
// ---------------------------------------------------------------------------

/// Spawn a dedicated OS thread that owns the `EnigoController` and processes
/// [`InputEvent`]s from the returned channel sender.
///
/// Enigo is not `Send` + `Sync`, so it must live on its own thread.
pub fn start_input_worker() -> Result<Sender<InputEvent>, String> {
    let (tx, rx) = channel::<InputEvent>();
    // `Enigo` is not `Send`, so it has to be built on the worker thread itself.
    // This handshake carries the outcome back, so a failure to connect to the
    // OS input APIs — on macOS, a missing Accessibility grant — surfaces at
    // startup instead of leaving a server that accepts gestures and drops them.
    let (ready_tx, ready_rx) = channel::<Result<(), String>>();

    std::thread::spawn(move || {
        let mut controller = match EnigoController::new() {
            Ok(controller) => {
                let _ = ready_tx.send(Ok(()));
                controller
            }
            Err(err) => {
                let _ = ready_tx.send(Err(format!(
                    "Could not connect to the system input APIs: {err}. \
                     On macOS, grant Accessibility permission and restart."
                )));
                return;
            }
        };

        loop {
            match rx.recv_timeout(ZOOM_RELEASE_TIMEOUT) {
                Ok(event) => dispatch_event(&mut controller, event),
                // Watchdog: a client that vanishes mid-pinch must never leave
                // the zoom modifier latched and hijack the physical keyboard.
                Err(RecvTimeoutError::Timeout) => controller.pinch_end(),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(tx),
        Ok(Err(message)) => Err(message),
        Err(_) => Err("The input worker stopped before it was ready.".to_string()),
    }
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
        InputEvent::KeyboardTap(key, mods) => controller.keyboard_tap(key, &mods),
        InputEvent::PinchZoom(delta) => controller.pinch_zoom(delta),
        InputEvent::PinchEnd => controller.pinch_end(),
    }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/// Named keys accepted by `keyboardTap`.
///
/// Kept deliberately in sync with `TAP_KEYS` in
/// `src-electron/server/validation.ts` so both backends expose an identical
/// surface.
fn parse_key(name: &str) -> Option<Key> {
    Some(match name {
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "enter" => Key::Return,
        "tab" => Key::Tab,
        "escape" => Key::Escape,
        "space" => Key::Space,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        _ => return None,
    })
}

/// Modifier names accepted alongside a `keyboardTap`.
fn parse_modifier(name: &str) -> Option<Key> {
    Some(match name {
        "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" => Key::Alt,
        "command" => Key::Meta,
        _ => return None,
    })
}

/// Extract a finite number clamped to +/- [`MAX_DELTA`].
///
/// Returns `None` for missing, non-numeric, or non-finite values so a malformed
/// message is dropped rather than silently reinterpreted as zero.
fn finite_clamped(value: &serde_json::Value) -> Option<f64> {
    let n = value.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.clamp(-MAX_DELTA, MAX_DELTA))
}

fn parse_button(value: &serde_json::Value) -> Option<EnigoButton> {
    match value.as_str()? {
        "left" => Some(EnigoButton::Left),
        "right" => Some(EnigoButton::Right),
        "middle" => Some(EnigoButton::Middle),
        _ => None,
    }
}

/// Validate a JSON event and produce the corresponding [`InputEvent`].
///
/// Returns `None` for anything unrecognised or out of range.
pub fn parse_event(event: &str, data: &serde_json::Value) -> Option<InputEvent> {
    match event {
        "mouseMove" | "mouseDrag" => {
            let dx = finite_clamped(&data["dx"])?;
            let dy = finite_clamped(&data["dy"])?;
            Some(InputEvent::MouseMove(dx as i32, dy as i32))
        }
        "mouseClick" => {
            let button = parse_button(&data["button"])?;
            let double = data["double"].as_bool().unwrap_or(false);
            Some(InputEvent::MouseClick(button, double))
        }
        "mouseDown" => Some(InputEvent::MouseDown(parse_button(&data["button"])?)),
        "mouseUp" => Some(InputEvent::MouseUp(parse_button(&data["button"])?)),
        "mouseScroll" => Some(InputEvent::MouseScroll(finite_clamped(&data["deltaY"])?)),
        "keyboardType" => {
            let text = data["text"].as_str()?;
            if text.is_empty() || text.chars().count() > MAX_TEXT_LENGTH {
                return None;
            }
            Some(InputEvent::KeyboardType(text.to_string()))
        }
        "keyboardTap" => {
            let key = parse_key(&data["key"].as_str()?.to_lowercase())?;
            let mut modifiers = Vec::new();
            if let Some(list) = data["modifiers"].as_array() {
                for m in list {
                    let parsed = parse_modifier(&m.as_str()?.to_lowercase())?;
                    if !modifiers.contains(&parsed) {
                        modifiers.push(parsed);
                    }
                }
            }
            Some(InputEvent::KeyboardTap(key, modifiers))
        }
        "pinchZoom" => Some(InputEvent::PinchZoom(finite_clamped(&data["delta"])?)),
        "pinchEnd" => Some(InputEvent::PinchEnd),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

fn json_message(value: serde_json::Value) -> Message {
    Message::Text(value.to_string())
}

/// Handle one WebSocket connection: authenticate, then route events.
async fn handle_socket(
    mut socket: WebSocket,
    tx: Sender<InputEvent>,
    state: Arc<AppState>,
    address: String,
) {
    println!("New WebSocket connection: {}", address);
    let mut authenticated = false;
    let mut last_activity = Instant::now();

    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(text) => text,
            Message::Close(_) => break,
            // Binary/ping/pong carry no input events for this protocol.
            _ => continue,
        };

        if text.len() > MAX_FRAME_BYTES {
            continue;
        }

        // Drop sessions that have gone idle rather than leaving the machine
        // controllable by a phone left forgotten on a desk.
        if authenticated && last_activity.elapsed() > SESSION_IDLE {
            let _ = socket
                .send(json_message(serde_json::json!({
                    "event": "auth_error",
                    "data": { "message": "Session expired. Re-enter the PIN." }
                })))
                .await;
            break;
        }

        let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let event = val["event"].as_str().unwrap_or("");
        let data = &val["data"];

        // --- auth gate ---
        if !authenticated {
            if event != "auth" {
                continue;
            }

            if let Some(wait) = state.retry_after(&address) {
                let _ = socket
                    .send(json_message(serde_json::json!({
                        "event": "auth_error",
                        "data": { "message": format!(
                            "Too many attempts. Try again in {}s.", wait.as_secs() + 1) }
                    })))
                    .await;
                continue;
            }

            let provided_pin = data["pin"].as_str().unwrap_or("");
            if constant_time_eq(provided_pin, &state.pin) {
                authenticated = true;
                last_activity = Instant::now();
                state.record_success(&address);
                println!("Client authenticated: {}", address);
                let _ = socket
                    .send(json_message(serde_json::json!({ "event": "auth_success" })))
                    .await;
            } else {
                let lockout = state.record_failure(&address);
                let message = match lockout {
                    Some(d) => format!("Too many attempts. Locked for {}s.", d.as_secs()),
                    None => "Invalid PIN".to_string(),
                };
                let _ = socket
                    .send(json_message(serde_json::json!({
                        "event": "auth_error",
                        "data": { "message": message }
                    })))
                    .await;
                if lockout.is_some() {
                    break;
                }
            }
            continue;
        }

        // --- event routing ---
        last_activity = Instant::now();
        if let Some(input) = parse_event(event, data) {
            let _ = tx.send(input);
        }
    }

    println!("WebSocket connection closed: {}", address);
}

// ---------------------------------------------------------------------------
// Axum HTTP + WebSocket server
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ServerContext {
    state: Arc<AppState>,
    tx: Sender<InputEvent>,
}

// Note: `std::sync::mpsc::Sender<T>` has been `Sync` since Rust 1.72, which is
// what lets `ServerContext` satisfy axum's `State` bounds without a wrapper.

async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(ctx): State<ServerContext>,
) -> axum::response::Response {
    ws.max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| {
            handle_socket(
                socket,
                ctx.tx.clone(),
                ctx.state.clone(),
                addr.ip().to_string(),
            )
        })
}

/// Start the Axum server (HTTP file serving + `/ws` WebSocket endpoint).
///
/// This is intended to be called inside a `std::thread::spawn` block with its
/// own `tokio::runtime::Runtime`, keeping async I/O off the Tauri main thread.
///
/// Returns an error rather than panicking so a busy port surfaces in the UI.
pub async fn run_server(
    state: Arc<AppState>,
    tx: Sender<InputEvent>,
    public_path: PathBuf,
) -> Result<(), String> {
    let ctx = ServerContext { state, tx };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new(public_path))
        .with_state(ctx);

    let bind_addr = SocketAddr::from(([0, 0, 0, 0], SERVER_PORT));
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                format!(
                    "Port {} is already in use. Close the other app and restart RemoteMouse.",
                    SERVER_PORT
                )
            } else {
                format!("Could not start the server: {}", e)
            }
        })?;

    println!("WebSocket server listening on :{}", SERVER_PORT);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|e| format!("Server stopped unexpectedly: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_events_and_bad_shapes() {
        assert!(parse_event("evil", &serde_json::json!({})).is_none());
        assert!(parse_event("mouseMove", &serde_json::json!({ "dx": "x", "dy": 1 })).is_none());
        assert!(parse_event("mouseClick", &serde_json::json!({ "button": "hax" })).is_none());
        assert!(parse_event("keyboardTap", &serde_json::json!({ "key": "meta" })).is_none());
    }

    #[test]
    fn rejects_oversized_and_empty_text() {
        let long = "a".repeat(MAX_TEXT_LENGTH + 1);
        assert!(parse_event("keyboardType", &serde_json::json!({ "text": long })).is_none());
        assert!(parse_event("keyboardType", &serde_json::json!({ "text": "" })).is_none());
        assert!(parse_event("keyboardType", &serde_json::json!({ "text": "ok" })).is_some());
    }

    #[test]
    fn clamps_out_of_range_deltas() {
        let event = parse_event("mouseMove", &serde_json::json!({ "dx": 1e12, "dy": -1e12 }));
        match event {
            Some(InputEvent::MouseMove(dx, dy)) => {
                assert_eq!(dx, MAX_DELTA as i32);
                assert_eq!(dy, -(MAX_DELTA as i32));
            }
            _ => panic!("expected a clamped MouseMove"),
        }
    }

    #[test]
    fn rejects_non_finite_deltas() {
        // NaN/Infinity are not valid JSON numbers, but a f64 cast of a huge
        // integer literal still has to be rejected rather than wrapped.
        assert!(parse_event("mouseScroll", &serde_json::json!({ "deltaY": null })).is_none());
    }

    #[test]
    fn private_ranges_include_172_16_through_31() {
        assert!(is_private_ipv4(&Ipv4Addr::new(172, 16, 0, 1)));
        assert!(is_private_ipv4(&Ipv4Addr::new(172, 31, 255, 254)));
        assert!(!is_private_ipv4(&Ipv4Addr::new(172, 32, 0, 1)));
        assert!(!is_private_ipv4(&Ipv4Addr::new(8, 8, 8, 8)));
    }
}
