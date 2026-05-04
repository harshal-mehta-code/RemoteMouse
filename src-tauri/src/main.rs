#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::services::ServeDir;
use enigo::{Enigo, MouseControllable, MouseButton as EnigoButton, KeyboardControllable};
use local_ip_address::local_ip;
use serde::Serialize;

#[derive(Clone, Serialize)]
struct ConnectionInfo {
    url: String,
}

#[tauri::command]
async fn get_connection_info() -> Result<ConnectionInfo, String> {
    let my_local_ip = local_ip().map_err(|e| e.to_string())?;
    let url = format!("http://{}:3000", my_local_ip);
    Ok(ConnectionInfo { url })
}

async fn handle_socket(mut socket: WebSocket) {
    println!("New WebSocket connection established");
    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            let mut enigo = Enigo::new();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                let event = val["event"].as_str().unwrap_or("");
                let data = &val["data"];

                match event {
                    "mouseMove" => {
                        let dx = data["dx"].as_f64().unwrap_or(0.0) as i32;
                        let dy = data["dy"].as_f64().unwrap_or(0.0) as i32;
                        enigo.mouse_move_relative(dx, dy);
                    }
                    "mouseClick" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let is_double = data["double"].as_bool().unwrap_or(false);
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        if is_double {
                            enigo.mouse_click(enigo_button);
                            enigo.mouse_click(enigo_button);
                        } else {
                            enigo.mouse_click(enigo_button);
                        }
                    }
                    "mouseDown" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        enigo.mouse_down(enigo_button);
                    }
                    "mouseUp" => {
                        let button = data["button"].as_str().unwrap_or("left");
                        let enigo_button = if button == "right" { EnigoButton::Right } else { EnigoButton::Left };
                        enigo.mouse_up(enigo_button);
                    }
                    "mouseDrag" => {
                        let dx = data["dx"].as_f64().unwrap_or(0.0) as i32;
                        let dy = data["dy"].as_f64().unwrap_or(0.0) as i32;
                        enigo.mouse_move_relative(dx, dy);
                    }
                    "mouseScroll" => {
                        let dy = data["deltaY"].as_f64().unwrap_or(0.0) as i32;
                        enigo.mouse_scroll_y(-dy / 10);
                    }
                    "keyboardType" => {
                        if let Some(text) = data["text"].as_str() {
                            enigo.key_sequence(text);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

fn main() {
    // Start Axum Server in a separate thread
    std::thread::spawn(|| {
        let base_path = std::env::current_dir().unwrap();
        let public_path = base_path.join("public");
        
        let app = Router::new()
            .route("/ws", get(ws_handler))
            .fallback_service(ServeDir::new(public_path));

        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
            axum::serve(listener, app).await.unwrap();
        });
    });

    tauri::Builder::default()
        .setup(|app| {
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
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .icon(app.default_window_icon().unwrap().clone())
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_connection_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
