#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod mouse_controller;
mod network;
mod tray;

use std::sync::{Arc, Mutex};
use tauri::Manager;

use auth::{generate_pin, AppState};
use network::{get_ip_address, run_server, start_input_worker, SERVER_PORT};

/// Startup failure message, surfaced to the popover instead of a silent hang.
#[derive(Default)]
struct StartupError(Mutex<Option<String>>);

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_connection_info(
    state: tauri::State<Arc<AppState>>,
    error: tauri::State<StartupError>,
) -> serde_json::Value {
    if let Some(message) = error.0.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return serde_json::json!({ "url": "", "pin": state.pin, "error": message });
    }

    match get_ip_address() {
        Some(ip) => serde_json::json!({
            "url": format!("http://{}:{}", ip, SERVER_PORT),
            "pin": state.pin,
        }),
        None => serde_json::json!({
            "url": "",
            "pin": state.pin,
            "error": "No network connection found. Connect to Wi-Fi and reopen this menu.",
        }),
    }
}

/// Report whether the OS will actually let us synthesise input events.
///
/// On macOS the app can run, serve the UI, and accept connections while every
/// cursor movement is silently discarded until the user grants Accessibility
/// permission — so the popover checks this and tells them.
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Prompts once with the standard system dialog, then reflects the
        // current trust state on subsequent calls.
        unsafe {
            use std::ffi::c_void;

            #[link(name = "ApplicationServices", kind = "framework")]
            extern "C" {
                fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
            }

            AXIsProcessTrustedWithOptions(std::ptr::null())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Resolve the directory holding the mobile UI.
///
/// Release builds always use the bundled resource directory. The source-tree
/// fallback is compiled in only for debug builds, so a stray `src-shared`
/// directory in a user's working directory can never take precedence over the
/// files shipped inside the app bundle.
fn resolve_public_path(app: &tauri::App) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [
            cwd.join("src-shared").join("public"),
            cwd.parent()
                .map(|p| p.join("src-shared").join("public"))
                .unwrap_or_default(),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    app.handle()
        .path()
        .resource_dir()
        .map(|dir| dir.join("public"))
        .unwrap_or_else(|_| std::path::PathBuf::from("public"))
}

fn main() {
    let pin = generate_pin();
    println!("Pairing PIN: {}", pin);

    let state = Arc::new(AppState::new(pin));

    tauri::Builder::default()
        .manage(state.clone())
        .manage(StartupError::default())
        .setup(move |app| {
            let public_path = resolve_public_path(app);
            println!("Serving mobile interface from: {:?}", public_path);

            // Spin up the Axum HTTP + WebSocket server on its own thread.
            let tx = start_input_worker();
            let state_clone = state.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt,
                    Err(e) => {
                        report_startup_error(&app_handle, format!("Could not start runtime: {}", e));
                        return;
                    }
                };
                if let Err(message) = rt.block_on(run_server(state_clone, tx, public_path)) {
                    eprintln!("Server error: {}", message);
                    report_startup_error(&app_handle, message);
                }
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

fn report_startup_error(app: &tauri::AppHandle, message: String) {
    if let Some(state) = app.try_state::<StartupError>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(message);
    }
}
