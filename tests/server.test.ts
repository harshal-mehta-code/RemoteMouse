import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';

import { resolveStaticPath } from '../src-electron/server/index';
import { validateEvent, LIMITS } from '../src-electron/server/validation';
import { AuthGuard, AuthThrottle } from '../src-electron/server/auth';
import { RobotJsController, SCROLL_PIXELS_PER_CLICK, ZOOM_RELEASE_TIMEOUT_MS } from '../src-electron/server/mouse_controller';

const robot = require('robotjs') as {
    calls: unknown[][];
    reset(): void;
};

const ROOT = path.resolve('/app/public');

/** The zoom modifier differs per platform; CI runs these on Linux. */
const ZOOM_MOD = process.platform === 'darwin' ? 'command' : 'control';

/** The security property under test: a resolved path never escapes the root. */
function isContained(requestUrl: string): boolean {
    const resolved = resolveStaticPath(ROOT, requestUrl);
    return resolved === null || resolved === ROOT || resolved.startsWith(ROOT + path.sep);
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

test('serves expected files', () => {
    assert.equal(resolveStaticPath(ROOT, '/'), path.join(ROOT, 'index.html'));
    assert.equal(resolveStaticPath(ROOT, '/style.css'), path.join(ROOT, 'style.css'));
    assert.equal(resolveStaticPath(ROOT, '/style.css?v=1'), path.join(ROOT, 'style.css'));
});

test('rejects null bytes and undecodable paths', () => {
    assert.equal(resolveStaticPath(ROOT, '/index.html%00.png'), null);
    assert.equal(resolveStaticPath(ROOT, '/%E0%A4%A'), null);
});

test('no traversal vector escapes the public root', () => {
    const attacks = [
        '/../../../../etc/passwd',
        '/../etc/passwd',
        '//etc/passwd',
        '/./../../etc/shadow',
        '/%2e%2e%2f%2e%2e%2fetc/passwd',
        '/%2e%2e/%2e%2e/etc/passwd',
        '/..%2f..%2fetc/passwd',
        '/....//....//etc/passwd',
        '/a/../../../../../../etc/passwd',
        '/%252e%252e%252fetc',
        '/index.html/../../../../etc/passwd',
        '/../publicX/secret',
        '/~/.ssh/id_rsa',
        '/../.env',
    ];
    for (const attack of attacks) {
        assert.ok(isContained(attack), `escaped the root: ${attack}`);
    }
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('rejects unknown and malformed events', () => {
    assert.equal(validateEvent({ event: 'exec', data: {} }), null);
    assert.equal(validateEvent(null), null);
    assert.equal(validateEvent({ data: {} }), null);
    assert.equal(validateEvent({ event: 'mouseMove', data: { dx: 'x', dy: 1 } }), null);
    assert.equal(validateEvent({ event: 'mouseMove', data: { dx: NaN, dy: 0 } }), null);
    assert.equal(validateEvent({ event: 'mouseMove', data: { dx: Infinity, dy: 0 } }), null);
    assert.equal(validateEvent({ event: 'mouseClick', data: { button: 'evil' } }), null);
});

test('bounds keyboard input', () => {
    const long = 'a'.repeat(LIMITS.MAX_TEXT_LENGTH + 1);
    assert.equal(validateEvent({ event: 'keyboardType', data: { text: long } }), null);
    assert.equal(validateEvent({ event: 'keyboardType', data: { text: '' } }), null);
    assert.notEqual(validateEvent({ event: 'keyboardType', data: { text: 'hello' } }), null);
});

test('allows only listed keys and modifiers', () => {
    assert.equal(validateEvent({ event: 'keyboardTap', data: { key: 'meta' } }), null);
    assert.equal(
        validateEvent({ event: 'keyboardTap', data: { key: 'enter', modifiers: ['pwn'] } }),
        null
    );
    const ok = validateEvent({ event: 'keyboardTap', data: { key: 'ENTER', modifiers: ['Command'] } });
    assert.deepEqual(ok, { event: 'keyboardTap', data: { key: 'enter', modifiers: ['command'] } });
});

test('clamps out-of-range deltas', () => {
    const event = validateEvent({ event: 'mouseMove', data: { dx: 1e12, dy: -1e12 } });
    assert.deepEqual(event, {
        event: 'mouseMove',
        data: { dx: LIMITS.MAX_DELTA, dy: -LIMITS.MAX_DELTA },
    });
});

test('validates PIN shape', () => {
    assert.equal(validateEvent({ event: 'auth', data: { pin: '12' } }), null);
    assert.equal(validateEvent({ event: 'auth', data: { pin: 'abcdef' } }), null);
    assert.notEqual(validateEvent({ event: 'auth', data: { pin: '123456' } }), null);
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('throttle locks out after repeated failures', () => {
    const throttle = new AuthThrottle();
    for (let i = 0; i < 4; i++) throttle.recordFailure('1.2.3.4');
    assert.equal(throttle.retryAfter('1.2.3.4'), 0, 'must not lock before the limit');

    assert.equal(throttle.recordFailure('1.2.3.4'), 30_000, 'fifth failure locks out');
    assert.ok(throttle.retryAfter('1.2.3.4') > 0);
    assert.equal(throttle.retryAfter('9.9.9.9'), 0, 'other addresses unaffected');

    throttle.recordSuccess('1.2.3.4');
    assert.equal(throttle.retryAfter('1.2.3.4'), 0);
});

test('lockout escalates on repeat offences', () => {
    const throttle = new AuthThrottle();
    const lockouts: number[] = [];
    for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 5; i++) {
            const applied = throttle.recordFailure('5.5.5.5');
            if (applied) lockouts.push(applied);
        }
    }
    assert.deepEqual(lockouts, [30_000, 60_000, 120_000]);
});

test('guard gates input on authentication', () => {
    const sent: string[] = [];
    const ws = { readyState: 1, send: (m: string) => sent.push(m), close: () => {} } as any;
    const guard = new AuthGuard('654321', ws, new AuthThrottle(), 'a.b.c.d');

    assert.equal(guard.handleMessage({ event: 'mouseMove', data: { dx: 5, dy: 5 } } as any), false);
    assert.equal(guard.handleMessage({ event: 'auth', data: { pin: '000000' } } as any), false);
    assert.equal(guard.isAuthenticated, false);

    assert.equal(guard.handleMessage({ event: 'auth', data: { pin: '654321' } } as any), true);
    assert.equal(guard.handleMessage({ event: 'mouseMove', data: { dx: 5, dy: 5 } } as any), true);
});

// ---------------------------------------------------------------------------
// Input dispatch
// ---------------------------------------------------------------------------

test('slow scrolling is not truncated away', () => {
    robot.reset();
    const controller = new RobotJsController();

    // Each event is a fraction of one scroll click; together they make exactly one.
    const perEvent = SCROLL_PIXELS_PER_CLICK / 4;
    for (let i = 0; i < 4; i++) {
        controller.processEvent({ event: 'mouseScroll', data: { deltaY: -perEvent } });
    }

    const scrolls = robot.calls.filter((c) => c[0] === 'scrollMouse');
    assert.equal(scrolls.length, 1, 'four sub-click events should emit one click');
    assert.deepEqual(scrolls[0], ['scrollMouse', 0, 1]);
});

test('pinch zoom works on this platform, whichever mechanism applies', () => {
    robot.reset();
    const controller = new RobotJsController();

    // A realistic gesture: many small deltas, then an explicit end.
    for (let i = 0; i < 10; i++) {
        controller.processEvent({ event: 'pinchZoom', data: { delta: 40 } });
    }

    if (process.platform === 'darwin') {
        // robotjs cannot flag a scroll event, so Cmd+scroll would do nothing;
        // discrete zoom keystrokes are used instead.
        const taps = robot.calls.filter((c) => c[0] === 'keyTap');
        assert.ok(taps.length > 0, 'macOS must emit zoom keystrokes');
        assert.deepEqual(taps[0], ['keyTap', '=', ['command']], 'spread fingers = zoom in');
        assert.equal(
            robot.calls.filter((c) => c[0] === 'scrollMouse').length,
            0,
            'must not emit an unflagged scroll that silently does nothing'
        );
    } else {
        const toggles = robot.calls.filter((c) => c[0] === 'keyToggle');
        assert.deepEqual(
            toggles,
            [['keyToggle', ZOOM_MOD, 'down']],
            'modifier pressed once, not tapped per event'
        );
        assert.equal(
            robot.calls.filter((c) => c[0] === 'scrollMouse').length,
            10,
            'every step should scroll'
        );

        controller.processEvent({ event: 'pinchEnd' });
        assert.deepEqual(robot.calls.filter((c) => c[0] === 'keyToggle'), [
            ['keyToggle', ZOOM_MOD, 'down'],
            ['keyToggle', ZOOM_MOD, 'up'],
        ]);
    }
});

test('zoom direction is correct on macOS', { skip: process.platform !== 'darwin' }, () => {
    robot.reset();
    const controller = new RobotJsController();
    controller.processEvent({ event: 'pinchZoom', data: { delta: -400 } });
    const taps = robot.calls.filter((c) => c[0] === 'keyTap');
    assert.deepEqual(taps[0], ['keyTap', '-', ['command']], 'pinch together = zoom out');
});

test('pinchEnd is idempotent and safe without a gesture', () => {
    robot.reset();
    const controller = new RobotJsController();
    controller.processEvent({ event: 'pinchEnd' });
    controller.processEvent({ event: 'pinchEnd' });
    assert.deepEqual(robot.calls, [], 'no stray modifier release');
});

test('watchdog releases a stranded modifier', { skip: process.platform === 'darwin' }, async () => {
    robot.reset();
    const controller = new RobotJsController();
    controller.processEvent({ event: 'pinchZoom', data: { delta: 400 } });
    assert.ok(robot.calls.some((c) => c[0] === 'keyToggle' && c[2] === 'down'));

    // Client vanishes mid-pinch: no pinchEnd ever arrives.
    await new Promise((r) => setTimeout(r, ZOOM_RELEASE_TIMEOUT_MS + 100));
    assert.ok(
        robot.calls.some((c) => c[0] === 'keyToggle' && c[2] === 'up'),
        'modifier must not stay latched after a dropped connection'
    );
});

test('keyboard tap forwards modifiers', () => {
    robot.reset();
    const controller = new RobotJsController();
    controller.processEvent({ event: 'keyboardTap', data: { key: 'left', modifiers: ['command'] } });
    assert.deepEqual(robot.calls, [['keyTap', 'left', ['command']]]);
});
