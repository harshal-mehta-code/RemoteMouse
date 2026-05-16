#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, AppHandle,
};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State as AxumState},
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::services::ServeDir;
use enigo::{Enigo, MouseControllable, MouseButton as EnigoButton, KeyboardControllable, Key};
use local_ip_address::list_afinet_netifas;
use serde::Serialize;
use std::sync::mpsc::{channel, Sender};

#[derive(Clone, Serialize)]
struct ConnectionInfo {
    url: String,
}

#[derive(Clone)]
enum EnigoEvent {
    MouseMove(i32, i32),
    MouseClick(EnigoButton, bool),
    MouseDown(EnigoButton),
    MouseUp(EnigoButton),
    MouseScroll(i32),
    KeyboardType(String),
    KeyboardTap(Key),
}

struct AppState {
    #[allow(dead_code)]
    tx: Sender<EnigoEvent>,
}

#[tauri::command]
async fn get_connection_info() -> Result<ConnectionInfo, String> {
    let network_interfaces = list_afinet_netifas().map_err(|e| e.to_string())?;
    
    let mut backup_ip = String::from("localhost");
    
    for (_name, ip) in network_interfaces {
        if ip.is_ipv4() && !ip.is_loopback() {
            let ip_str = ip.to_string();
            if ip_str.starts_with("192.168.") || ip_str.starts_with("10.") {
                return Ok(ConnectionInfo { url: format!("http://{}:3005", ip_str) });
            }
            backup_ip = ip_str;
        }
    }
    
    Ok(ConnectionInfo { url: format!("http://{}:3005", backup_ip) })
}

#[tauri::command]
fn check_accessibility() -> bool {
    // For now, return true. On macOS, Enigo will just fail or the OS will prompt.
    true
}

#[tauri::command]
fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

fn start_enigo_worker() -> Sender<EnigoEvent> {
    let (tx, rx) = channel::<EnigoEvent>();
    std::thread::spawn(move || {
        let mut enigo = Enigo::new();
        while let Ok(event) = rx.recv() {
            match event {
                EnigoEvent::MouseMove(dx, dy) => enigo.mouse_move_relative(dx, dy),
                EnigoEvent::MouseClick(btn, double) => {
                    enigo.mouse_click(btn);
                    if double { enigo.mouse_click(btn); }
                }
                EnigoEvent::MouseDown(btn) => enigo.mouse_down(btn),
                EnigoEvent::MouseUp(btn) => enigo.mouse_up(btn),
                EnigoEvent::MouseScroll(dy) => enigo.mouse_scroll_y(dy),
                EnigoEvent::KeyboardType(text) => enigo.key_sequence(&text),
                EnigoEvent::KeyboardTap(key) => enigo.key_click(key),
            }
        }
    });
    tx
}

async fn handle_socket(mut socket: WebSocket, tx: Sender<EnigoEvent>) {
    println!("New WebSocket connection established");
    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                let event = val["event"].as_str().unwrap_or("");
                let data = &val["data"];

                match event {
                    "mouseMove" => {
                        let dx = data["dx"].as_f64().unwrap_or(0.0) as i32;
                        let dy = data["dy"].as_f64().unwrap_or(0.0) as i32;
                        let _ = tx.send(EnigoEvent::MouseMove(dx, dy));
                    }
                    "mouseClick" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let is_double = data["double"].as_bool().unwrap_or(false);
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        let _ = tx.send(EnigoEvent::MouseClick(enigo_button, is_double));
                    }
                    "mouseDown" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        let _ = tx.send(EnigoEvent::MouseDown(enigo_button));
                    }
                    "mouseUp" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        let _ = tx.send(EnigoEvent::MouseUp(enigo_button));
                    }
                    "mouseDrag" => {
                        let dx = data["dx"].as_f64().unwrap_or(0.0) as i32;
                        let dy = data["dy"].as_f64().unwrap_or(0.0) as i32;
                        let _ = tx.send(EnigoEvent::MouseMove(dx, dy));
                    }
                    "mouseScroll" => {
                        let dy = data["deltaY"].as_f64().unwrap_or(0.0) as i32;
                        let _ = tx.send(EnigoEvent::MouseScroll(-dy / 10));
                    }
                    "keyboardType" => {
                        if let Some(text) = data["text"].as_str() {
                            let _ = tx.send(EnigoEvent::KeyboardType(text.to_string()));
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
                                let _ = tx.send(EnigoEvent::KeyboardTap(k));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

async fn ws_handler(ws: WebSocketUpgrade, AxumState(tx): AxumState<Sender<EnigoEvent>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, tx))
}

fn start_axum_server(app_handle: AppHandle, tx: Sender<EnigoEvent>) {
    let resource_path = app_handle.path().resource_dir().unwrap_or_else(|_| std::env::current_dir().unwrap());
    
    let mut public_path = resource_path.clone();
    
    // In dev, it's usually in a 'public' folder. In bundle, it might be flattened.
    if resource_path.join("public").exists() {
        public_path = resource_path.join("public");
    } else if !resource_path.join("index.html").exists() {
        // Check for Tauri's '_up_' prefix
        let up_path = resource_path.join("_up_").join("public");
        if up_path.exists() {
            public_path = up_path;
        } else if let Ok(cwd) = std::env::current_dir() {
            if cwd.join("public").exists() {
                public_path = cwd.join("public");
            }
        }
    }

    println!("Serving public from: {:?}", public_path);

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new(public_path))
        .with_state(tx);

    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("0.0.0.0:3005").await.unwrap();
            axum::serve(listener, app).await.unwrap();
        });
    });
}

fn main() {
    let tx = start_enigo_worker();

    tauri::Builder::default()
        .manage(AppState { tx: tx.clone() })
        .setup(move |app| {
            let handle = app.handle();
            start_axum_server(handle.clone(), tx);

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let scale_factor = window.scale_factor().unwrap_or(1.0);
                            let window_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(300, 500));
                            
                            let icon_pos = rect.position.to_physical::<f64>(scale_factor);
                            let icon_size = rect.size.to_physical::<f64>(scale_factor);
                            
                            let icon_center_x = icon_pos.x + (icon_size.width / 2.0);
                            let window_x = icon_center_x - (window_size.width as f64 / 2.0);
                            let window_y = icon_pos.y + icon_size.height;
                            
                            let _ = window.set_position(tauri::PhysicalPosition::new(window_x, window_y));
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .icon(app.default_window_icon().unwrap().clone())
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => {
                if !focused && window.label() == "main" {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![get_connection_info, check_accessibility, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
