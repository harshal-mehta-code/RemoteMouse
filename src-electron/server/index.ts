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

export function getIPAddress(): string {
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
    return '0.0.0.0';
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export async function startServer(port: number = 3000, pin: string): Promise<string> {
    const ip = getIPAddress();
    const url = `http://${ip}:${port}`;

    // HTTP file server — serves the shared mobile UI from the public directory.
    const server = http.createServer((req, res) => {
        const publicDir = path.join(__dirname, 'public');
        const filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url!);

        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end(JSON.stringify(err)); return; }
            res.writeHead(200);
            res.end(data);
        });
    });

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

    server.listen(port);
    console.log(`Server live at ${url}`);
    return url;
}

