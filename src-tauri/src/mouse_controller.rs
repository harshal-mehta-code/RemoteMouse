use enigo::{Enigo, MouseControllable, MouseButton as EnigoButton, KeyboardControllable, Key};

/// A unified interface for dispatching input events to the OS.
///
/// This trait is the single point of extension for adding new input backends.
/// The only current implementation is [`EnigoController`], but any alternative
/// (e.g. a testing mock, or a different input library) simply implements this
/// trait and wires into [`crate::network::start_input_worker`].
///
/// Note: `Send` is intentionally NOT required — `Enigo` on macOS holds a
/// non-`Send` `CGEventSource` raw pointer. All implementations run exclusively
/// on the dedicated input worker thread via a channel.
pub trait MouseController {
    fn mouse_move(&mut self, dx: i32, dy: i32);
    fn mouse_click(&mut self, button: EnigoButton, double: bool);
    fn mouse_down(&mut self, button: EnigoButton);
    fn mouse_up(&mut self, button: EnigoButton);
    fn mouse_scroll(&mut self, dy: i32);
    fn keyboard_type(&mut self, text: &str);
    fn keyboard_tap(&mut self, key: Key);
    fn pinch_zoom(&mut self, delta: i32);
}

/// Production implementation of [`MouseController`] backed by the `enigo` crate.
pub struct EnigoController {
    enigo: Enigo,
}

impl EnigoController {
    pub fn new() -> Self {
        Self { enigo: Enigo::new() }
    }
}

impl MouseController for EnigoController {
    fn mouse_move(&mut self, dx: i32, dy: i32) {
        self.enigo.mouse_move_relative(dx, dy);
    }

    fn mouse_click(&mut self, button: EnigoButton, double: bool) {
        self.enigo.mouse_click(button);
        if double {
            self.enigo.mouse_click(button);
        }
    }

    fn mouse_down(&mut self, button: EnigoButton) {
        self.enigo.mouse_down(button);
    }

    fn mouse_up(&mut self, button: EnigoButton) {
        self.enigo.mouse_up(button);
    }

    fn mouse_scroll(&mut self, dy: i32) {
        self.enigo.mouse_scroll_y(dy);
    }

    fn keyboard_type(&mut self, text: &str) {
        self.enigo.key_sequence(text);
    }

    fn keyboard_tap(&mut self, key: Key) {
        self.enigo.key_click(key);
    }

    fn pinch_zoom(&mut self, delta: i32) {
        let modifier = if cfg!(target_os = "macos") { Key::Meta } else { Key::Control };
        self.enigo.key_down(modifier);
        self.enigo.mouse_scroll_y(delta);
        self.enigo.key_up(modifier);
    }
}
