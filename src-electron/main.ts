import { app, nativeImage, ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import menubar = require('menubar');
import * as qrcode from 'qrcode';
import { startServer } from './server/index';
import { ConnectionInfo } from '../src-shared/types';

// Optional macOS permissions check
if (process.platform === 'darwin') {
    try {
        const permissions = require('node-mac-permissions');
        const status = permissions.getAuthStatus('accessibility');
        if (status !== 'authorized') {
            permissions.askForAccessibilityAccess();
        }
    } catch (e) {
        console.warn('node-mac-permissions not available');
    }
}

let cachedUrl: string | null = null;
let cachedQrCode: string | null = null;
const pairingPin = Math.floor(1000 + Math.random() * 9000).toString();

const iconPath = path.join(__dirname, 'iconTemplate.png');

const mb = menubar({
    index: `file://${path.join(__dirname, 'tray-popover.html')}`,
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
    },
    icon: iconPath,
    preloadWindow: true,
    showDockIcon: false
});

mb.on('ready', async () => {
    console.log('Window Created.');
    console.log(`--- REMOTE TOUCHPAD READY (PIN: ${pairingPin}) ---`);

    try {
        const url = await startServer(3000, pairingPin);
        cachedUrl = url;
        cachedQrCode = await qrcode.toDataURL(url);
        console.log('QR Code cached.');
    } catch (err) {
        console.error('Failed to start server:', err);
    }
});

ipcMain.on('get-connection-info', (event) => {
    if (cachedUrl) {
        const info: ConnectionInfo & { pin: string } = {
            url: cachedUrl,
            qrCodeDataUrl: cachedQrCode || undefined,
            pin: pairingPin
        };
        event.reply('connection-info', info);
    }
});

ipcMain.on('quit-app', () => {
    app.quit();
});
