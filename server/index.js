const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const robot = require('robotjs');
const permissions = require('node-mac-permissions');
const path = require('path');
const os = require('os');

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

function startServer(port = 3000) {
    // Check accessibility permissions
    const status = permissions.getAuthStatus('accessibility');
    if (status !== 'authorized') {
        console.log('Asking for accessibility permission...');
        permissions.askForAccessibilityAccess();
    }

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    app.use(express.static(path.join(__dirname, '../public')));

    io.on('connection', (socket) => {
        console.log('A client connected');

        socket.on('mouseMove', (data) => {
            const currentPos = robot.getMousePos();
            robot.moveMouse(currentPos.x + data.dx, currentPos.y + data.dy);
        });

        socket.on('mouseClick', (data) => {
            if (data.button === 'left') {
                robot.mouseClick('left');
            } else if (data.button === 'right') {
                robot.mouseClick('right', false);
            }
        });

        socket.on('mouseScroll', (data) => {
            const scrollAmount = Math.round(data.deltaY);
            if (scrollAmount !== 0) {
                robot.scrollMouse(0, -scrollAmount);
            }
        });

        socket.on('keyboardType', (data) => {
            if (data.text) {
                robot.typeString(data.text);
            }
        });

        socket.on('keyboardTap', (data) => {
            if (data.key) {
                robot.keyTap(data.key);
            }
        });

        socket.on('disconnect', () => {
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
