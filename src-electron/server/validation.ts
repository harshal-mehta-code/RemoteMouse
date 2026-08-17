import { RemoteEvent, MouseButton } from '../../src-shared/types';

/**
 * Hard limits applied to every inbound WebSocket message.
 *
 * The server is reachable by anything on the local network, so untrusted input
 * must never reach `robotjs` unbounded — a single oversized `keyboardType`
 * would otherwise block the main thread for minutes while it synthesises
 * keystrokes.
 */
export const LIMITS = {
    /** Maximum raw WebSocket frame size, enforced by `ws` via `maxPayload`. */
    MAX_FRAME_BYTES: 4096,
    /** Maximum characters accepted in a single `keyboardType` event. */
    MAX_TEXT_LENGTH: 256,
    /** Maximum absolute value for any pointer delta, in pixels. */
    MAX_DELTA: 5000,
} as const;

const MOUSE_BUTTONS: readonly string[] = ['left', 'right', 'middle'];

/**
 * Key names accepted by `keyboardTap`, kept deliberately in sync with the
 * Rust backend's table in `src-tauri/src/network.rs` so both backends expose an
 * identical surface. Values are the canonical robotjs key names.
 */
export const TAP_KEYS: readonly string[] = [
    'backspace', 'delete', 'enter', 'tab', 'escape', 'space',
    'up', 'down', 'left', 'right',
    'home', 'end', 'pageup', 'pagedown',
    'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
];

/** Modifier names accepted alongside a `keyboardTap`. */
export const TAP_MODIFIERS: readonly string[] = ['control', 'shift', 'alt', 'command'];

/**
 * Coerce a value to a finite number clamped to +/- `max`.
 *
 * @returns the clamped number, or `null` if the input was not a finite number.
 */
function finiteClamped(value: unknown, max: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(-max, Math.min(max, value));
}

/**
 * Validate and normalise a parsed JSON payload into a trusted {@link RemoteEvent}.
 *
 * Unknown event names, malformed shapes, and out-of-range values are rejected
 * rather than coerced to a default, so a malformed message is dropped instead
 * of being silently reinterpreted as a different gesture.
 *
 * @returns the sanitised event, or `null` if the payload is not valid.
 */
export function validateEvent(raw: unknown): RemoteEvent | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const { event, data } = raw as { event?: unknown; data?: unknown };
    if (typeof event !== 'string') return null;

    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

    switch (event) {
        case 'auth': {
            const pin = d.pin;
            if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return null;
            return { event: 'auth', data: { pin } };
        }

        case 'mouseMove':
        case 'mouseDrag': {
            const dx = finiteClamped(d.dx, LIMITS.MAX_DELTA);
            const dy = finiteClamped(d.dy, LIMITS.MAX_DELTA);
            if (dx === null || dy === null) return null;
            return { event, data: { dx: Math.round(dx), dy: Math.round(dy) } };
        }

        case 'mouseClick':
        case 'mouseDown':
        case 'mouseUp': {
            const button = d.button;
            if (typeof button !== 'string' || !MOUSE_BUTTONS.includes(button)) return null;
            const double = d.double === true;
            return { event, data: { button: button as MouseButton, double } };
        }

        case 'mouseScroll': {
            const deltaY = finiteClamped(d.deltaY, LIMITS.MAX_DELTA);
            if (deltaY === null) return null;
            return { event: 'mouseScroll', data: { deltaY } };
        }

        case 'keyboardType': {
            const text = d.text;
            if (typeof text !== 'string' || text.length === 0) return null;
            if (text.length > LIMITS.MAX_TEXT_LENGTH) return null;
            return { event: 'keyboardType', data: { text } };
        }

        case 'keyboardTap': {
            const key = d.key;
            if (typeof key !== 'string') return null;
            const normalisedKey = key.toLowerCase();
            if (!TAP_KEYS.includes(normalisedKey)) return null;

            const rawModifiers = Array.isArray(d.modifiers) ? d.modifiers : [];
            const modifiers: string[] = [];
            for (const m of rawModifiers) {
                if (typeof m !== 'string') return null;
                const normalised = m.toLowerCase();
                if (!TAP_MODIFIERS.includes(normalised)) return null;
                if (!modifiers.includes(normalised)) modifiers.push(normalised);
            }

            return { event: 'keyboardTap', data: { key: normalisedKey, modifiers } };
        }

        case 'pinchZoom': {
            const delta = finiteClamped(d.delta, LIMITS.MAX_DELTA);
            if (delta === null) return null;
            return { event: 'pinchZoom', data: { delta } };
        }

        case 'pinchEnd':
            return { event: 'pinchEnd' };

        default:
            return null;
    }
}
