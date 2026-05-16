import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import * as robot from 'robotjs';
import * as qrcode from 'qrcode';
import { networkInterfaces } from 'os';
import { RemoteEvent } from '../../src-shared/types';

export function getIPAddress(): string {
    const interfaces = networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        if (!iface) continue;
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '0.0.0.0';
}

export async function startServer(port: number = 3000, pin: string): Promise<string> {
    const ip = getIPAddress();
    const url = `http://${ip}:${port}`;

    const server = http.createServer((req, res) => {
        const publicDir = path.join(__dirname, 'public');
        let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url!);

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end(JSON.stringify(err));
                return;
            }
            res.writeHead(200);
            res.end(data);
        });
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws: WebSocket) => {
        console.log('Client connected');
        let authenticated = false;

        ws.on('message', (message: string) => {
            try {
                const payload: RemoteEvent = JSON.parse(message);
                
                if (!authenticated) {
                    if (payload.event === 'auth') {
                        if (payload.data.pin === pin) {
                            authenticated = true;
                            ws.send(JSON.stringify({ event: 'auth_success' }));
                        } else {
                            ws.send(JSON.stringify({ event: 'auth_error', data: { message: 'Invalid PIN' } }));
                        }
                    }
                    return;
                }

                handleEvent(payload);
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        });
    });

    server.listen(port);
    console.log(`Server live at ${url}`);

    return url;
}

function handleEvent(payload: RemoteEvent) {
    const { event, data } = payload;

    switch (event) {
        case 'mouseMove':
        case 'mouseDrag':
            const mouse = robot.getMousePos();
            robot.moveMouse(mouse.x + (data as any).dx, mouse.y + (data as any).dy);
            break;
        case 'mouseClick':
            robot.mouseClick((data as any).button, (data as any).double);
            break;
        case 'mouseDown':
            robot.mouseToggle('down', (data as any).button);
            break;
        case 'mouseUp':
            robot.mouseToggle('up', (data as any).button);
            break;
        case 'mouseScroll':
            robot.scrollMouse(0, (data as any).deltaY);
            break;
        case 'keyboardType':
            robot.typeString((data as any).text);
            break;
        case 'keyboardTap':
            robot.keyTap((data as any).key);
            break;
    }
}
