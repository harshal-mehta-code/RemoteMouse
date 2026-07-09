import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { RemoteEvent } from '../../src-shared/types';
import { AuthGuard } from './auth';
import { RobotJsController } from './mouse_controller';

// ---------------------------------------------------------------------------
// IP discovery
// ---------------------------------------------------------------------------

/** Return the first non-internal LAN IPv4 address, or `null` if none exists. */
export function getIPAddress(): string | null {
    const interfaces = networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        if (!iface) continue;
        for (const alias of iface) {
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/** Serve a single file request from `publicDir`, rejecting any path traversal attempt. */
function serveStatic(publicDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawUrl = req.url === '/' ? '/index.html' : (req.url || '/index.html');
    const decodedPath = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
    const resolvedPath = path.normalize(path.join(publicDir, decodedPath));

    // Ensure the resolved path never escapes publicDir (blocks `..` traversal).
    if (resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(resolvedPath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(resolvedPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export async function startServer(port: number, pin: string): Promise<string> {
    const ip = getIPAddress();
    if (!ip) {
        throw new Error('No Wi-Fi/LAN network was detected. Connect to a network and reopen this menu.');
    }
    const url = `http://${ip}:${port}`;
    const publicDir = path.join(__dirname, 'public');

    const server = http.createServer((req, res) => serveStatic(publicDir, req, res));

    // WebSocket server — one AuthGuard + one RobotJsController per connection.
    const wss = new WebSocketServer({ server });
    const controller = new RobotJsController();

    wss.on('connection', (ws: WebSocket) => {
        console.log('Client connected');
        const auth = new AuthGuard(pin, ws);

        ws.on('message', (message: Buffer | string) => {
            try {
                const payload: RemoteEvent = JSON.parse(message.toString());
                if (!auth.handleMessage(payload)) return;
                controller.processEvent(payload);
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', (err) => reject(err));
        // Bind only to the detected LAN interface, not all interfaces (0.0.0.0).
        server.listen(port, ip, () => {
            console.log(`Server live at ${url}`);
            resolve(url);
        });
    });
}
