#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod mouse_controller;
mod network;
mod tray;

use std::sync::Arc;
use tauri::Manager;

use auth::{generate_pin, AppState};
use network::{get_ip_address, run_server, start_input_worker};

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_connection_info(state: tauri::State<Arc<AppState>>) -> serde_json::Value {
    let ip = get_ip_address();
    serde_json::json!({
        "url": format!("http://{}:3005", ip),
        "pin": state.pin.clone()
    })
}

#[tauri::command]
fn check_accessibility() -> bool {
    true
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    let pin = generate_pin();
    println!("Pairing PIN: {}", pin);

    let state = Arc::new(AppState::new(pin));

    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            // Resolve the path to the shared mobile UI.
            let resource_path = app
                .handle()
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap());
            let mut public_path = resource_path.join("public");

            if let Ok(cwd) = std::env::current_dir() {
                let shared = cwd.join("src-shared").join("public");
                let parent_shared = cwd
                    .parent()
                    .map(|p| p.join("src-shared").join("public"))
                    .unwrap_or_default();

                if shared.exists() {
                    public_path = shared;
                } else if parent_shared.exists() {
                    public_path = parent_shared;
                }
            }

            println!("Serving mobile interface from: {:?}", public_path);

            // Spin up the Axum HTTP + WebSocket server on its own thread.
            let tx = start_input_worker();
            let state_clone = state.clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(run_server(state_clone, tx, public_path));
            });

            // Set up the system-tray icon and popover behaviour.
            tray::setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "main" {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_connection_info,
            check_accessibility,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

