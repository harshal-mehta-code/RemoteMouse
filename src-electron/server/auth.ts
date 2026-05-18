import { WebSocket } from 'ws';
import { RemoteEvent } from '../../src-shared/types';

/**
 * Manages the authentication lifecycle for a single WebSocket connection.
 * Callers pass every incoming message through `handleMessage`; the guard
 * responds on the socket and signals whether the caller should proceed with
 * event routing.
 */
export class AuthGuard {
    private _authenticated = false;

    constructor(private readonly pin: string, private readonly ws: WebSocket) {}

    get isAuthenticated(): boolean {
        return this._authenticated;
    }

    /**
     * Process an incoming message for the auth phase.
     *
     * @returns `true` if the connection is now (or was already) authenticated
     *          and the caller should route the event, `false` otherwise.
     */
    handleMessage(payload: RemoteEvent): boolean {
        if (this._authenticated) return true;

        if (payload.event === 'auth') {
            if (payload.data.pin === this.pin) {
                this._authenticated = true;
                this.ws.send(JSON.stringify({ event: 'auth_success' }));
            } else {
                this.ws.send(
                    JSON.stringify({ event: 'auth_error', data: { message: 'Invalid PIN' } })
                );
            }
        }

        return this._authenticated;
    }
}
