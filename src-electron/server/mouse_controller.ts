import * as robot from 'robotjs';
import { RemoteEvent } from '../../src-shared/types';

/**
 * Wire-protocol scaling constants.
 *
 * The client sends raw finger travel in CSS pixels; each backend converts that
 * to its own native scroll unit. These values are mirrored in
 * `src-tauri/src/mouse_controller.rs` so both backends feel identical.
 */
export const SCROLL_PIXELS_PER_CLICK = 8;
/**
 * Finger travel per zoom step.
 *
 * macOS zooms via discrete Cmd+`=`/`-` keystrokes, where one step is a whole
 * zoom level, so it needs a coarser threshold than the smooth scroll-based zoom
 * used elsewhere. Verified empirically: Cmd+scroll and synthesized magnify
 * gestures produce no zoom at all on macOS.
 */
export const ZOOM_PIXELS_PER_STEP = process.platform === 'darwin' ? 90 : 40;
/** Ceiling on buffered zoom steps, so a fast pinch cannot outrun the drain rate. */
const MAX_BUFFERED_ZOOM = 2;
/** Upper bound on scroll clicks emitted from a single event. */
const MAX_SCROLL_CLICKS = 40;
/** Upper bound on zoom steps emitted from a single event. */
const MAX_ZOOM_STEPS = 5;
/** Release the held zoom modifier if no pinch event arrives within this window. */
export const ZOOM_RELEASE_TIMEOUT_MS = 300;
/**
 * Cap on discrete zoom keystrokes per event (macOS only). Keystrokes are far
 * heavier than scroll ticks, so this stays low to keep the gesture responsive.
 */
const MAX_ZOOM_KEYSTROKES = 1;

/**
 * Unified interface for dispatching input events to the OS.
 *
 * The only current implementation is {@link RobotJsController}, but any
 * alternative (e.g. `nut-js`, or a test mock) just implements this interface
 * and is passed into the WebSocket server — no other code changes.
 */
export interface MouseController {
    processEvent(event: RemoteEvent): void;
}

/**
 * Production implementation of {@link MouseController} backed by `robotjs`.
 */
export class RobotJsController implements MouseController {
    /**
     * Fractional scroll/zoom carried between events.
     *
     * Without this, dividing pixel deltas down to integer clicks truncates every
     * slow gesture to zero and the surface feels dead below a threshold.
     */
    private scrollRemainder = 0;
    private zoomRemainder = 0;

    /** Whether the zoom modifier is currently held down. */
    private zoomModifierHeld = false;
    /** Safety net in case the client disconnects mid-pinch. */
    private zoomReleaseTimer: NodeJS.Timeout | null = null;

    private get zoomModifier(): string {
        return process.platform === 'darwin' ? 'command' : 'control';
    }

    /**
     * Apply `steps` of zoom, using whichever mechanism works on this platform.
     *
     * - **Windows / Linux**: hold the modifier and scroll. The OS reads live
     *   keyboard state when the wheel event is processed, so this works.
     * - **macOS**: discrete Cmd+`=`/`-` keystrokes. Determined empirically —
     *   Cmd-flagged scroll events (LINE and PIXEL units) and synthesized
     *   `NSEventTypeMagnify` gestures all produced no zoom at all in Safari.
     *   Cmd+scroll is a Windows/Chromium idiom, not a macOS one. Honoured by
     *   browsers, editors, and most document apps, but note that fully native
     *   apps such as Photos respond only to real trackpad gestures and will not
     *   zoom. The Tauri backend uses the same keystroke approach.
     */
    private zoom(steps: number): void {
        if (process.platform === 'darwin') {
            const key = steps > 0 ? '=' : '-';
            const count = Math.min(Math.abs(steps), MAX_ZOOM_KEYSTROKES);
            for (let i = 0; i < count; i++) {
                robot.keyTap(key, ['command']);
            }
            return;
        }

        // Press once and hold for the whole gesture. Toggling per event would
        // fire a burst of bare modifier taps and would mean the scroll is not
        // actually modified.
        this.holdZoomModifier();
        robot.scrollMouse(0, clamp(steps, MAX_ZOOM_STEPS));
    }

    private holdZoomModifier(): void {
        if (!this.zoomModifierHeld) {
            robot.keyToggle(this.zoomModifier, 'down');
            this.zoomModifierHeld = true;
        }
        // Refresh the watchdog: a dropped connection must never leave the
        // modifier latched and hijack the user's physical keyboard.
        if (this.zoomReleaseTimer) clearTimeout(this.zoomReleaseTimer);
        this.zoomReleaseTimer = setTimeout(() => this.releaseZoomModifier(), ZOOM_RELEASE_TIMEOUT_MS);
        this.zoomReleaseTimer.unref?.();
    }

    private releaseZoomModifier(): void {
        if (this.zoomReleaseTimer) {
            clearTimeout(this.zoomReleaseTimer);
            this.zoomReleaseTimer = null;
        }
        if (this.zoomModifierHeld) {
            robot.keyToggle(this.zoomModifier, 'up');
            this.zoomModifierHeld = false;
        }
        this.zoomRemainder = 0;
    }

    processEvent(event: RemoteEvent): void {
        switch (event.event) {
            case 'mouseMove':
            case 'mouseDrag': {
                const pos = robot.getMousePos();
                robot.moveMouse(pos.x + event.data.dx, pos.y + event.data.dy);
                break;
            }
            case 'mouseClick':
                robot.mouseClick(event.data.button, event.data.double ?? false);
                break;
            case 'mouseDown':
                robot.mouseToggle('down', event.data.button);
                break;
            case 'mouseUp':
                robot.mouseToggle('up', event.data.button);
                break;
            case 'mouseScroll': {
                this.scrollRemainder += -event.data.deltaY / SCROLL_PIXELS_PER_CLICK;
                const clicks = Math.trunc(this.scrollRemainder);
                this.scrollRemainder -= clicks;
                if (clicks !== 0) {
                    robot.scrollMouse(0, clamp(clicks, MAX_SCROLL_CLICKS));
                }
                break;
            }
            case 'keyboardType':
                robot.typeString(event.data.text);
                break;
            case 'keyboardTap':
                robot.keyTap(event.data.key, event.data.modifiers ?? []);
                break;
            case 'pinchZoom': {
                this.zoomRemainder = clamp(
                    this.zoomRemainder + event.data.delta / ZOOM_PIXELS_PER_STEP,
                    MAX_BUFFERED_ZOOM
                );
                const steps = Math.trunc(this.zoomRemainder);
                this.zoomRemainder -= steps;
                if (steps === 0) break;

                this.zoom(steps);
                break;
            }
            case 'pinchEnd':
                this.releaseZoomModifier();
                break;
        }
    }
}

function clamp(value: number, max: number): number {
    return Math.max(-max, Math.min(max, value));
}
