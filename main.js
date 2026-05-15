const { menubar } = require('menubar');
const { app, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');

// Import our server logic
const { startServer, getIPAddress } = require('./server/index.js');

// Constants
const PORT = 3000;
const IP = getIPAddress();
const URL = `http://${IP}:${PORT}`;

// Pre-calculate QR Code
let cachedQRCode = null;
async function generateQR() {
    try {
        cachedQRCode = await QRCode.toDataURL(URL, {
            width: 250,
            margin: 2
        });
        console.log('QR Code cached.');
    } catch (err) {
        console.error('QR Generation Error:', err);
    }
}
generateQR();

// Listen for requests from the popover window (OUTSIDE READY)
ipcMain.on('get-connection-info', (event) => {
    console.log('Popover requested info. Sending URL:', URL);
    event.reply('connection-info', { url: URL, qrCodeDataUrl: cachedQRCode });
});

ipcMain.on('quit-app', () => {
    app.quit();
});

const iconPath = path.join(__dirname, 'iconTemplate.png');
const trayIcon = nativeImage.createFromPath(iconPath);
if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
}

const mb = menubar({
    index: `file://${path.join(__dirname, 'tray-popover.html')}`,
    browserWindow: {
        width: 300,
        height: 550,
        resizable: false,
        show: false,
        frame: false,
        transparent: true,
        ...(process.platform === 'darwin' ? {
            vibrancy: 'under-window',
            visualEffectState: 'active'
        } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    },
    icon: trayIcon,
    preloadWindow: true,
    showDockIcon: false
});

mb.on('ready', () => {
    console.log('--- REMOTE TOUCHPAD READY ---');
    
    // Add standard context menu on right click
    const { Menu } = require('electron');
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Quit RemoteMouse', click: () => { app.quit(); } }
    ]);
    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });

    try {
        startServer(PORT);
        console.log(`Server live at ${URL}`);
    } catch (err) {
        console.error('Server Start Error:', err);
    }
});

mb.on('after-create-window', () => {
    console.log('Window Created.');
});

mb.on('error', (error) => {
    console.error('Menubar Error:', error);
});
