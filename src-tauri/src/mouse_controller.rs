use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, InputError, Key, Keyboard, Mouse, NewConError,
    Settings,
};

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
/// zoom used elsewhere. See [`EnigoController::zoom`].
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

/// Log an input failure at most once per call site.
///
/// An [`InputError`] means something structural is wrong — revoked Accessibility
/// permission, a dead event source — not a transient hiccup. The first one is
/// worth surfacing; the next thousand, arriving at gesture frequency, are noise
/// that would bury it. Failures are never fatal: one dropped event must not take
/// down the input worker and with it every other gesture.
macro_rules! warn_once {
    ($result:expr, $what:literal) => {
        if let Err(err) = $result {
            static WARNED: std::sync::Once = std::sync::Once::new();
            WARNED.call_once(|| {
                let _: InputError = err;
                eprintln!("RemoteMouse: could not {}: {err}", $what);
            });
        }
    };
}

/// A unified interface for dispatching input events to the OS.
///
/// This trait is the single point of extension for adding new input backends.
/// The only current implementation is [`EnigoController`], but any alternative
/// (e.g. a testing mock, or a different input library) simply implements this
/// trait and wires into [`crate::network::start_input_worker`].
///
/// Note: `Send` is intentionally NOT required — `Enigo` holds platform handles
/// that are not safely shareable across threads. All implementations run
/// exclusively on the dedicated input worker thread via a channel.
pub trait MouseController {
    fn mouse_move(&mut self, dx: i32, dy: i32);
    fn mouse_click(&mut self, button: Button, double: bool);
    fn mouse_down(&mut self, button: Button);
    fn mouse_up(&mut self, button: Button);
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
    /// Construct a controller, connecting to the platform input APIs.
    ///
    /// Fails when the OS refuses a connection — on macOS this is what a missing
    /// Accessibility grant looks like. The caller surfaces that to the user
    /// rather than silently accepting input that will never move the cursor.
    pub fn new() -> Result<Self, NewConError> {
        Ok(Self {
            enigo: Enigo::new(&Settings::default())?,
            scroll_remainder: 0.0,
            zoom_remainder: 0.0,
            zoom_modifier_held: false,
        })
    }

    /// Zoom by holding the platform modifier across the gesture and scrolling.
    ///
    /// This is the path on Windows and Linux, where the OS reads live keyboard
    /// state when the wheel event is processed, so Ctrl+wheel is both idiomatic
    /// and smooth (non-discrete). The modifier is pressed once per gesture and
    /// never toggled per event: a burst of bare modifier taps is both wrong and,
    /// on some platforms, a system shortcut in its own right.
    #[cfg(not(target_os = "macos"))]
    fn modifier_zoom(&mut self, steps: i32) {
        if !self.zoom_modifier_held {
            warn_once!(
                self.enigo.key(ZOOM_MODIFIER, Direction::Press),
                "press the zoom modifier"
            );
            self.zoom_modifier_held = true;
        }
        // enigo negates the scroll length internally, so negate to zoom in.
        warn_once!(self.enigo.scroll(-steps, Axis::Vertical), "scroll to zoom");
    }

    /// Zoom with discrete Command+`=`/`-` keystrokes.
    ///
    /// This is the macOS path, and the choice is empirically determined rather
    /// than a preference. Against Safari, all of the following produced no zoom
    /// whatsoever:
    ///
    /// - Command-flagged scroll events (in both LINE and PIXEL units)
    /// - Synthesized `NSEventTypeMagnify` gesture sequences
    ///
    /// Cmd+scroll is a Windows/Chromium idiom, not a macOS one, and macOS
    /// discards synthesized magnify gestures. Flagged keystrokes are what
    /// actually works. Don't re-litigate those two without testing first.
    ///
    /// The Command flag has to land on the key event itself. enigo 0.6 tracks
    /// held modifiers and applies them to every event it posts, so a plain
    /// press/raw/release produces a real Cmd+`=`; enigo 0.1 set flags on no
    /// event at all, which made this read as a bare Cmd tap and opened the
    /// "Type to Siri" prompt instead of zooming.
    #[cfg(target_os = "macos")]
    fn keystroke_zoom(&mut self, steps: i32) {
        /// Keystrokes are a large visual jump, so never fire more than one per event.
        const MAX_KEYSTROKES: i32 = 1;

        let keycode = if steps > 0 {
            ZOOM_IN_KEYCODE
        } else {
            ZOOM_OUT_KEYCODE
        };
        for _ in 0..steps.abs().min(MAX_KEYSTROKES) {
            warn_once!(
                self.enigo.key(ZOOM_MODIFIER, Direction::Press),
                "press the zoom modifier"
            );
            warn_once!(
                self.enigo.raw(keycode, Direction::Click),
                "send a zoom keystroke"
            );
            warn_once!(
                self.enigo.key(ZOOM_MODIFIER, Direction::Release),
                "release the zoom modifier"
            );
        }
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
        warn_once!(
            self.enigo.move_mouse(dx, dy, Coordinate::Rel),
            "move the cursor"
        );
    }

    fn mouse_click(&mut self, button: Button, double: bool) {
        warn_once!(self.enigo.button(button, Direction::Click), "click");
        if double {
            warn_once!(self.enigo.button(button, Direction::Click), "click");
        }
    }

    fn mouse_down(&mut self, button: Button) {
        warn_once!(
            self.enigo.button(button, Direction::Press),
            "press a mouse button"
        );
    }

    fn mouse_up(&mut self, button: Button) {
        warn_once!(
            self.enigo.button(button, Direction::Release),
            "release a mouse button"
        );
    }

    fn mouse_scroll(&mut self, delta_y: f64) {
        self.scroll_remainder += -delta_y / SCROLL_PIXELS_PER_CLICK;
        let clicks = take_whole(&mut self.scroll_remainder, MAX_SCROLL_CLICKS);
        if clicks != 0 {
            warn_once!(self.enigo.scroll(clicks, Axis::Vertical), "scroll");
        }
    }

    fn keyboard_type(&mut self, text: &str) {
        warn_once!(self.enigo.text(text), "type text");
    }

    fn keyboard_tap(&mut self, key: Key, modifiers: &[Key]) {
        for m in modifiers {
            warn_once!(self.enigo.key(*m, Direction::Press), "press a modifier");
        }
        warn_once!(self.enigo.key(key, Direction::Click), "tap a key");
        // Released in reverse order, and unconditionally, so a modifier can
        // never stay latched and hijack the user's physical keyboard.
        for m in modifiers.iter().rev() {
            warn_once!(self.enigo.key(*m, Direction::Release), "release a modifier");
        }
    }

    fn pinch_zoom(&mut self, delta: f64) {
        self.zoom_remainder = (self.zoom_remainder + delta / ZOOM_PIXELS_PER_STEP)
            .clamp(-MAX_BUFFERED_ZOOM, MAX_BUFFERED_ZOOM);
        let steps = take_whole(&mut self.zoom_remainder, MAX_ZOOM_STEPS);
        if steps == 0 {
            return;
        }

        // Positive `steps` means fingers spreading, which must zoom in.
        #[cfg(target_os = "macos")]
        self.keystroke_zoom(steps);
        #[cfg(not(target_os = "macos"))]
        self.modifier_zoom(steps);
    }

    fn pinch_end(&mut self) {
        // Unconditional even on the keystroke path: `zoom_modifier_held` is only
        // ever set by `modifier_zoom`, and leaving a modifier latched is the one
        // failure here the user cannot recover from without unplugging.
        if self.zoom_modifier_held {
            warn_once!(
                self.enigo.key(ZOOM_MODIFIER, Direction::Release),
                "release the zoom modifier"
            );
            self.zoom_modifier_held = false;
        }
        self.zoom_remainder = 0.0;
    }
}

/// Modifier that turns a scroll or `=`/`-` into a zoom on this platform.
#[cfg(target_os = "macos")]
const ZOOM_MODIFIER: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const ZOOM_MODIFIER: Key = Key::Control;

/// Virtual keycodes for the macOS zoom keys (`kVK_ANSI_Equal` / `kVK_ANSI_Minus`).
///
/// These are posted with [`enigo::Keyboard::raw`] rather than as
/// `Key::Unicode('=')`, and that is load-bearing rather than stylistic.
///
/// `Key::Unicode` resolves the character through the active keyboard layout via
/// Carbon's `TISGetInputSourceProperty`. That function asserts it is running on
/// the main dispatch queue and **aborts the process** — `EXC_BREAKPOINT` raised
/// from `dispatch_assert_queue` — when it is not, and every event here is
/// dispatched on a dedicated input worker thread. It is also gratuitously
/// expensive: the lookup walks all 128 keycodes calling `UCKeyTranslate` twice
/// each, per keystroke, at gesture frequency.
///
/// Physical keycodes are the better semantics regardless. Zoom belongs to the
/// key in that position, which is where layouts put their zoom shortcut, not to
/// whatever character the active layout happens to map there.
#[cfg(target_os = "macos")]
const ZOOM_IN_KEYCODE: u16 = 24;
#[cfg(target_os = "macos")]
const ZOOM_OUT_KEYCODE: u16 = 27;

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

    /// The zoom modifier must match the platform: Command on macOS, Control
    /// elsewhere. Changing one `cfg` and forgetting the other yields a gesture
    /// that silently does nothing.
    #[test]
    fn zoom_modifier_matches_the_platform() {
        let modifier = std::hint::black_box(ZOOM_MODIFIER);
        let expected = if cfg!(target_os = "macos") {
            Key::Meta
        } else {
            Key::Control
        };
        assert_eq!(modifier, expected);
    }

    /// The zoom keycodes must stay the ANSI `=` and `-` positions.
    ///
    /// They are hardcoded precisely so that nothing resolves them through the
    /// keyboard layout at runtime — that call aborts the process off the main
    /// thread. See [`ZOOM_IN_KEYCODE`]. Deliberately not cross-checked against
    /// enigo's own layout lookup here: `cargo test` runs each test on its own
    /// thread, so doing so would crash the test binary for the same reason.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_zoom_keycodes_are_ansi_equal_and_minus() {
        assert_eq!(std::hint::black_box(ZOOM_IN_KEYCODE), 24);
        assert_eq!(std::hint::black_box(ZOOM_OUT_KEYCODE), 27);
    }
}
