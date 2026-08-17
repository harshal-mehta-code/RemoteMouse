use enigo::{Enigo, Key, KeyboardControllable, MouseButton as EnigoButton, MouseControllable};

/// Wire-protocol scaling constants.
///
/// The client sends raw finger travel in CSS pixels; each backend converts that
/// to its own native scroll unit. These values are mirrored in
/// `src-electron/server/mouse_controller.ts` so both backends feel identical.
pub const SCROLL_PIXELS_PER_CLICK: f64 = 8.0;

/// Finger travel per zoom step.
///
/// macOS zooms via discrete Cmd+`=`/`-` keystrokes, where one step is a whole
/// zoom level, so it needs a coarser threshold than the smooth scroll-based
/// zoom used elsewhere. See [`try_native_zoom`].
#[cfg(target_os = "macos")]
pub const ZOOM_PIXELS_PER_STEP: f64 = 90.0;
#[cfg(not(target_os = "macos"))]
pub const ZOOM_PIXELS_PER_STEP: f64 = 40.0;

/// Ceiling on buffered zoom steps.
///
/// Only one keystroke is emitted per event, so without this the accumulator
/// could outrun the drain rate during a fast pinch and keep zooming after the
/// fingers stop.
const MAX_BUFFERED_ZOOM: f64 = 2.0;
/// Upper bound on scroll clicks emitted from a single event.
const MAX_SCROLL_CLICKS: i32 = 40;
/// Upper bound on zoom steps emitted from a single event.
const MAX_ZOOM_STEPS: i32 = 5;
/// Release the held zoom modifier if no pinch event arrives within this window.
pub const ZOOM_RELEASE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(300);

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
    /// Scroll by a vertical finger travel expressed in CSS pixels.
    fn mouse_scroll(&mut self, delta_y: f64);
    fn keyboard_type(&mut self, text: &str);
    fn keyboard_tap(&mut self, key: Key, modifiers: &[Key]);
    /// Zoom by a pinch distance change expressed in CSS pixels.
    fn pinch_zoom(&mut self, delta: f64);
    /// End the current pinch gesture, releasing any held modifier.
    fn pinch_end(&mut self);
}

/// Production implementation of [`MouseController`] backed by the `enigo` crate.
pub struct EnigoController {
    enigo: Enigo,
    /// Fractional scroll/zoom carried between events.
    ///
    /// Without this, dividing pixel deltas down to integer clicks truncates
    /// every slow gesture to zero and the surface feels dead below a threshold.
    scroll_remainder: f64,
    zoom_remainder: f64,
    /// Whether the zoom modifier is currently held down.
    zoom_modifier_held: bool,
}

impl EnigoController {
    pub fn new() -> Self {
        Self {
            enigo: Enigo::new(),
            scroll_remainder: 0.0,
            zoom_remainder: 0.0,
            zoom_modifier_held: false,
        }
    }
}

impl Default for EnigoController {
    fn default() -> Self {
        Self::new()
    }
}

impl EnigoController {
    /// Zoom by holding the platform modifier across the gesture and scrolling.
    ///
    /// This is the primary path on Windows and Linux, where the OS reads live
    /// keyboard state when the wheel event is processed. The modifier is pressed
    /// once per gesture, never toggled per event: a burst of bare modifier taps
    /// is both wrong and, on some platforms, a system shortcut.
    fn modifier_zoom(&mut self, steps: i32) {
        if !self.zoom_modifier_held {
            self.enigo.key_down(zoom_modifier());
            self.zoom_modifier_held = true;
        }
        // enigo negates its argument on every backend, so negate to zoom in.
        self.enigo.mouse_scroll_y(-steps);
    }
}

/// Consume the whole part of `remainder`, leaving the fraction behind.
fn take_whole(remainder: &mut f64, max: i32) -> i32 {
    let whole = remainder.trunc();
    *remainder -= whole;
    (whole as i32).clamp(-max, max)
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

    fn mouse_scroll(&mut self, delta_y: f64) {
        self.scroll_remainder += -delta_y / SCROLL_PIXELS_PER_CLICK;
        let clicks = take_whole(&mut self.scroll_remainder, MAX_SCROLL_CLICKS);
        if clicks != 0 {
            self.enigo.mouse_scroll_y(clicks);
        }
    }

    fn keyboard_type(&mut self, text: &str) {
        self.enigo.key_sequence(text);
    }

    fn keyboard_tap(&mut self, key: Key, modifiers: &[Key]) {
        for m in modifiers {
            self.enigo.key_down(*m);
        }
        self.enigo.key_click(key);
        // Released in reverse order, and unconditionally, so a modifier can
        // never stay latched and hijack the user's physical keyboard.
        for m in modifiers.iter().rev() {
            self.enigo.key_up(*m);
        }
    }

    fn pinch_zoom(&mut self, delta: f64) {
        self.zoom_remainder =
            (self.zoom_remainder + delta / ZOOM_PIXELS_PER_STEP).clamp(-MAX_BUFFERED_ZOOM, MAX_BUFFERED_ZOOM);
        let steps = take_whole(&mut self.zoom_remainder, MAX_ZOOM_STEPS);
        if steps == 0 {
            return;
        }

        // Positive `steps` means fingers spreading, which must zoom in.
        // Prefer the platform-native path; fall back to holding the modifier so
        // a failure degrades to "maybe zooms" rather than "silently does
        // nothing".
        if try_native_zoom(steps) {
            return;
        }
        self.modifier_zoom(steps);
    }

    fn pinch_end(&mut self) {
        if self.zoom_modifier_held {
            self.enigo.key_up(zoom_modifier());
            self.zoom_modifier_held = false;
        }
        self.zoom_remainder = 0.0;
    }
}

/// Attempt a platform-native zoom that needs no held modifier.
///
/// Returns `true` if the zoom was delivered, `false` if the caller should fall
/// back to [`EnigoController::modifier_zoom`].
///
/// Only macOS needs this, and it uses discrete Command+`=` / Command+`-`
/// keystrokes. That choice is empirically determined, not a preference —
/// against Safari, all of the following produced no zoom whatsoever:
///
/// - Command-flagged scroll events (LINE units, and PIXEL units)
/// - Synthesized `NSEventTypeMagnify` gesture sequences
///
/// Cmd+scroll is a Windows/Chromium idiom, not a macOS one, and macOS discards
/// synthesized magnify gestures. Flagged keystrokes are what actually works.
///
/// The flag must be set on the key event itself: enigo's macOS backend sets
/// flags on no events at all, so `key_down(Meta)` + `key_click` is unreliable.
///
/// Windows and Linux deliberately return `false` — there the OS reads live
/// keyboard state when the wheel event is processed, so holding the modifier and
/// scrolling is both correct and idiomatic (and gives smooth, non-discrete zoom).
#[cfg(target_os = "macos")]
fn try_native_zoom(steps: i32) -> bool {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    /// kVK_ANSI_Equal / kVK_ANSI_Minus.
    const KEY_EQUAL: u16 = 24;
    const KEY_MINUS: u16 = 27;
    /// Keystrokes are a large visual jump, so never fire more than one per event.
    const MAX_KEYSTROKES: i32 = 1;

    let keycode = if steps > 0 { KEY_EQUAL } else { KEY_MINUS };
    let count = steps.abs().min(MAX_KEYSTROKES);

    for _ in 0..count {
        for pressed in [true, false] {
            let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
                warn_native_zoom_unavailable();
                return false;
            };
            let Ok(event) = CGEvent::new_keyboard_event(source, keycode, pressed) else {
                warn_native_zoom_unavailable();
                return false;
            };
            event.set_flags(CGEventFlags::CGEventFlagCommand);
            event.post(CGEventTapLocation::HID);
            // Give the receiving app time to register the modifier+key pair.
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn try_native_zoom(_steps: i32) -> bool {
    false
}

/// Warn once rather than per event, so a broken event source is visible in the
/// log without flooding it at gesture frequency.
#[cfg(target_os = "macos")]
fn warn_native_zoom_unavailable() {
    static WARNED: std::sync::Once = std::sync::Once::new();
    WARNED.call_once(|| {
        eprintln!(
            "Could not create a native zoom event; falling back to modifier+scroll. \
             Zoom may not work in all apps. Check Accessibility permission."
        );
    });
}

/// Modifier that turns a scroll into a zoom on this platform.
fn zoom_modifier() -> Key {
    if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Slow scrolling must not be silently truncated away.
    #[test]
    fn scroll_remainder_accumulates_below_one_click() {
        let mut remainder = 0.0;
        // Six events of 2px each: below one click individually, but they add up.
        let mut total = 0;
        for _ in 0..6 {
            remainder += 2.0 / SCROLL_PIXELS_PER_CLICK;
            total += take_whole(&mut remainder, MAX_SCROLL_CLICKS);
        }
        assert_eq!(total, 1, "6 x 2px should produce exactly one scroll click");
    }

    /// The zoom keystroke must carry the Command flag on the key event itself.
    ///
    /// This is the crux of the bug: enigo's macOS backend sets flags on no event
    /// at all, so `key_down(Meta)` + `key_click('=')` does not reliably reach the
    /// app as Cmd+`=`. Verified empirically — flagged keystrokes zoom Safari,
    /// while Cmd-flagged scrolls and synthesized magnify gestures do nothing.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_zoom_keystroke_carries_the_command_flag() {
        use core_graphics::event::{CGEvent, CGEventFlags};
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
            eprintln!("no event source available (headless); skipping");
            return;
        };
        let event = CGEvent::new_keyboard_event(source, 24, true).expect("key event");

        assert!(
            !event.get_flags().contains(CGEventFlags::CGEventFlagCommand),
            "a bare key event starts unflagged — this is why relying on a held Cmd failed"
        );

        event.set_flags(CGEventFlags::CGEventFlagCommand);
        assert!(
            event.get_flags().contains(CGEventFlags::CGEventFlagCommand),
            "zoom keystroke must carry Command"
        );
    }

    /// A fast pinch must not keep zooming after the fingers stop.
    #[test]
    fn buffered_zoom_cannot_run_away() {
        let mut remainder: f64 = 0.0;
        for _ in 0..50 {
            remainder = (remainder + 500.0 / ZOOM_PIXELS_PER_STEP)
                .clamp(-MAX_BUFFERED_ZOOM, MAX_BUFFERED_ZOOM);
            let _ = take_whole(&mut remainder, MAX_ZOOM_STEPS);
        }
        assert!(
            remainder.abs() <= MAX_BUFFERED_ZOOM,
            "accumulator must stay bounded, got {remainder}"
        );
    }

    #[test]
    fn take_whole_clamps_and_preserves_fraction() {
        let mut remainder = 3.75;
        assert_eq!(take_whole(&mut remainder, 2), 2);
        assert!((remainder - 0.75).abs() < f64::EPSILON);
    }
}
