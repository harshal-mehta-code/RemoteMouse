use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Set up the system-tray icon, context menu, and popover window behaviour.
///
/// - Left-click: position and show the main window directly below the tray icon.
/// - Right-click / menu: "Quit" exits the application.
pub fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit_i])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                app.exit(0)
            }
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
                    let window_size = window
                        .inner_size()
                        .unwrap_or(tauri::PhysicalSize::new(300, 720));

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
}
