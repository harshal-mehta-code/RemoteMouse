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

        socket.on('mouseDrag', (data) => {
            const currentPos = robot.getMousePos();
            robot.dragMouse(currentPos.x + data.dx, currentPos.y + data.dy);
        });

        socket.on('mouseClick', (data) => {
            if (data.double) {
                robot.mouseClick(data.button || 'left', true);
            } else {
                robot.mouseClick(data.button || 'left');
            }
        });

        socket.on('mouseDown', (data) => {
            robot.mouseToggle('down', data.button || 'left');
        });

        socket.on('mouseUp', (data) => {
            robot.mouseToggle('up', data.button || 'left');
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
