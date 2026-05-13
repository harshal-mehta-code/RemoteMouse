const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const robot = require('robotjs');
const permissions = require('node-mac-permissions');

function getIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

function startServer(port = 3000) {
    // Check accessibility permissions
    const status = permissions.getAuthStatus('accessibility');
    if (status !== 'authorized') {
        console.log('Asking for accessibility permission...');
        permissions.askForAccessibilityAccess();
    }

    const publicDir = path.join(__dirname, '../public');

    const server = http.createServer((req, res) => {
        let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('File not found');
                } else {
                    res.writeHead(500);
                    res.end('Server error: ' + error.code);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        console.log('A client connected via WebSocket');

        ws.on('message', (message) => {
            try {
                const { event, data } = JSON.parse(message);

                switch (event) {
                    case 'mouseMove':
                        const currentPos = robot.getMousePos();
                        robot.moveMouse(currentPos.x + data.dx, currentPos.y + data.dy);
                        break;

                    case 'mouseDrag':
                        const dragPos = robot.getMousePos();
                        robot.dragMouse(dragPos.x + data.dx, dragPos.y + data.dy);
                        break;

                    case 'mouseClick':
                        robot.mouseClick(data.button || 'left', data.double || false);
                        break;

                    case 'mouseDown':
                        robot.mouseToggle('down', data.button || 'left');
                        break;

                    case 'mouseUp':
                        robot.mouseToggle('up', data.button || 'left');
                        break;

                    case 'mouseScroll':
                        const scrollAmount = Math.round(data.deltaY);
                        if (scrollAmount !== 0) {
                            robot.scrollMouse(0, -scrollAmount);
                        }
                        break;

                    case 'keyboardType':
                        if (data.text) {
                            robot.typeString(data.text);
                        }
                        break;

                    case 'keyboardTap':
                        if (data.key) {
                            robot.keyTap(data.key);
                        }
                        break;
                }
            } catch (err) {
                console.error('Error handling WS message:', err);
            }
        });

        ws.on('close', () => {
            console.log('A client disconnected');
        });
    });

    server.listen(port, '0.0.0.0', () => {
        const ip = getIPAddress();
        console.log(`Server is running on http://${ip}:${port}`);
    });

    return server;
}

// Export for electron
module.exports = { startServer, getIPAddress };

// If run directly via node
if (require.main === module) {
    startServer(3000);
}
