import * as robot from 'robotjs';
import { RemoteEvent } from '../../src-shared/types';

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
    processEvent(event: RemoteEvent): void {
        const { data } = event as any;

        switch (event.event) {
            case 'mouseMove':
            case 'mouseDrag': {
                const pos = robot.getMousePos();
                robot.moveMouse(pos.x + data.dx, pos.y + data.dy);
                break;
            }
            case 'mouseClick':
                robot.mouseClick(data.button, data.double ?? false);
                break;
            case 'mouseDown':
                robot.mouseToggle('down', data.button);
                break;
            case 'mouseUp':
                robot.mouseToggle('up', data.button);
                break;
            case 'mouseScroll':
                // Match the Tauri backend's scaling (src-tauri/src/network.rs) so
                // scroll speed/direction feel identical across both backends.
                robot.scrollMouse(0, Math.round(-data.deltaY / 10));
                break;
            case 'keyboardType':
                robot.typeString(data.text);
                break;
            case 'keyboardTap':
                robot.keyTap(data.key);
                break;
            case 'pinchZoom': {
                const modifier = process.platform === 'darwin' ? 'command' : 'control';
                robot.keyToggle(modifier, 'down');
                robot.scrollMouse(0, data.delta);
                robot.keyToggle(modifier, 'up');
                break;
            }
        }
    }
}
