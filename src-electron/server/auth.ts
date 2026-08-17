import { WebSocket } from 'ws';
import { RemoteEvent } from '../../src-shared/types';

/** Failed attempts allowed from one address before it is locked out. */
const MAX_ATTEMPTS = 5;
/** Base lockout duration; doubles on each subsequent lockout for the address. */
const BASE_LOCKOUT_MS = 30_000;
/** Upper bound on the escalating lockout. */
const MAX_LOCKOUT_MS = 15 * 60_000;
/** Idle period after which an authenticated session is dropped. */
export const SESSION_IDLE_MS = 30 * 60_000;

interface AttemptRecord {
    failures: number;
    lockouts: number;
    lockedUntil: number;
}

/**
 * Tracks failed PIN attempts per remote address.
 *
 * A 4-digit PIN is only 10,000 combinations, which an unthrottled attacker on
 * the LAN exhausts in seconds. State is keyed by address rather than by socket
 * so that reconnecting does not reset the counter.
 */
export class AuthThrottle {
    private readonly records = new Map<string, AttemptRecord>();

    /** Milliseconds remaining before `address` may attempt again, or 0. */
    retryAfter(address: string, now: number = Date.now()): number {
        const record = this.records.get(address);
        if (!record) return 0;
        return Math.max(0, record.lockedUntil - now);
    }

    /**
     * Record a failed attempt.
     *
     * @returns milliseconds of lockout just applied, or 0 if attempts remain.
     */
    recordFailure(address: string, now: number = Date.now()): number {
        const record = this.records.get(address) ?? { failures: 0, lockouts: 0, lockedUntil: 0 };
        record.failures += 1;

        let lockout = 0;
        if (record.failures >= MAX_ATTEMPTS) {
            lockout = Math.min(BASE_LOCKOUT_MS * 2 ** record.lockouts, MAX_LOCKOUT_MS);
            record.lockouts += 1;
            record.failures = 0;
            record.lockedUntil = now + lockout;
        }

        this.records.set(address, record);
        return lockout;
    }

    /** Clear all failure state for an address after a successful auth. */
    recordSuccess(address: string): void {
        this.records.delete(address);
    }
}

/**
 * Manages the authentication lifecycle for a single WebSocket connection.
 * Callers pass every incoming message through `handleMessage`; the guard
 * responds on the socket and signals whether the caller should proceed with
 * event routing.
 */
export class AuthGuard {
    private _authenticated = false;
    private _lastActivity = Date.now();

    constructor(
        private readonly pin: string,
        private readonly ws: WebSocket,
        private readonly throttle: AuthThrottle,
        private readonly address: string
    ) {}

    get isAuthenticated(): boolean {
        return this._authenticated;
    }

    /** True once an authenticated session has been idle past the timeout. */
    isIdleExpired(now: number = Date.now()): boolean {
        return this._authenticated && now - this._lastActivity > SESSION_IDLE_MS;
    }

    private send(event: string, data?: unknown): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data === undefined ? { event } : { event, data }));
        }
    }

    /**
     * Process an incoming message for the auth phase.
     *
     * @returns `true` if the connection is now (or was already) authenticated
     *          and the caller should route the event, `false` otherwise.
     */
    handleMessage(payload: RemoteEvent): boolean {
        if (this._authenticated) {
            this._lastActivity = Date.now();
            return true;
        }

        if (payload.event !== 'auth') return false;

        const waitMs = this.throttle.retryAfter(this.address);
        if (waitMs > 0) {
            this.send('auth_error', {
                message: `Too many attempts. Try again in ${Math.ceil(waitMs / 1000)}s.`,
            });
            return false;
        }

        // Constant-time-ish compare: length check first, then full scan without
        // early exit, so timing does not leak how many digits matched.
        if (equalsConstantTime(payload.data.pin, this.pin)) {
            this._authenticated = true;
            this._lastActivity = Date.now();
            this.throttle.recordSuccess(this.address);
            this.send('auth_success');
            return true;
        }

        const lockout = this.throttle.recordFailure(this.address);
        this.send('auth_error', {
            message: lockout > 0
                ? `Too many attempts. Locked for ${Math.ceil(lockout / 1000)}s.`
                : 'Invalid PIN',
        });

        if (lockout > 0) this.ws.close(4029, 'Too many attempts');
        return false;
    }
}

/** Compare two strings without an early-exit on the first differing byte. */
function equalsConstantTime(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
