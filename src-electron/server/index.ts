import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { AuthGuard, AuthThrottle } from './auth';
import { RobotJsController } from './mouse_controller';
import { LIMITS, validateEvent } from './validation';

// ---------------------------------------------------------------------------
// IP discovery
// ---------------------------------------------------------------------------

/** RFC 1918 private ranges, preferred over any other non-loopback address. */
function isPrivateIPv4(address: string): boolean {
    if (address.startsWith('192.168.') || address.startsWith('10.')) return true;
    const match = /^172\.(\d+)\./.exec(address);
    if (match) {
        const second = Number(match[1]);
        return second >= 16 && second <= 31;
    }
    return false;
}

/**
 * Return the LAN IPv4 address clients should connect to.
 *
 * Prefers an RFC 1918 private address, then any non-internal IPv4.
 *
 * @returns the address, or `null` when the host has no usable network
 *          interface — callers must surface this rather than advertising an
 *          unreachable URL.
 */
export function getIPAddress(): string | null {
    const interfaces = networkInterfaces();
    const candidates: string[] = [];

    for (const devName in interfaces) {
        const iface = interfaces[devName];
        if (!iface) continue;
        for (const alias of iface) {
            if (alias.family !== 'IPv4' || alias.internal) continue;
            if (alias.address === '127.0.0.1') continue;
            candidates.push(alias.address);
        }
    }

    return candidates.find(isPrivateIPv4) ?? candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

/**
 * Resolve a request URL to a file inside `publicDir`.
 *
 * The path is resolved and then re-checked against the root prefix, so
 * `..` segments and absolute paths cannot escape the served directory.
 *
 * @returns the absolute file path, or `null` if it escapes `publicDir`.
 */
export function resolveStaticPath(publicDir: string, requestUrl: string): string | null {
    // Strip query/hash and decode before normalising, so encoded traversal
    // sequences such as %2e%2e%2f are caught too.
    let pathname: string;
    try {
        pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
    } catch {
        return null;
    }

    if (pathname.includes('\0')) return null;

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const root = path.resolve(publicDir);
    const resolved = path.resolve(root, relative);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export async function startServer(port: number = 3000, pin: string): Promise<string> {
    const ip = getIPAddress();
    if (!ip) {
        throw new Error('No network connection found. Connect to Wi-Fi and restart RemoteMouse.');
    }
    const url = `http://${ip}:${port}`;

    // HTTP file server — serves the shared mobile UI from the public directory.
    const publicDir = path.resolve(path.join(__dirname, 'public'));
    const server = http.createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            return;
        }

        const filePath = resolveStaticPath(publicDir, req.url ?? '/');
        if (!filePath) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                return;
            }
            const contentType =
                MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store',
            });
            res.end(data);
        });
    });

    // WebSocket server — one AuthGuard per connection, one shared controller.
    const wss = new WebSocketServer({ server, maxPayload: LIMITS.MAX_FRAME_BYTES });
    const controller = new RobotJsController();
    const throttle = new AuthThrottle();

    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
        const address = req.socket.remoteAddress ?? 'unknown';
        console.log(`Client connected: ${address}`);
        const auth = new AuthGuard(pin, ws, throttle, address);

        // Drop sessions that have gone idle rather than leaving the machine
        // controllable by a phone left forgotten on a desk.
        const idleTimer = setInterval(() => {
            if (auth.isIdleExpired()) {
                ws.close(4001, 'Session idle timeout');
            }
        }, 60_000);
        ws.on('close', () => clearInterval(idleTimer));

        ws.on('message', (message: Buffer | string) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(message.toString());
            } catch {
                return; // Malformed JSON from an untrusted client — ignore.
            }

            const payload = validateEvent(parsed);
            if (!payload) return;

            if (!auth.handleMessage(payload)) return;
            if (payload.event === 'auth') return;

            controller.processEvent(payload);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
            reject(
                err.code === 'EADDRINUSE'
                    ? new Error(`Port ${port} is already in use. Close the other app and restart RemoteMouse.`)
                    : err
            );
        });
        server.listen(port, () => resolve());
    });

    console.log(`Server live at ${url}`);
    return url;
}
