import { app, ipcMain } from 'electron';
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
let startupError: string | null = null;

const pairingPin = generatePin();

/** Generate a uniformly-distributed 6-digit PIN using a CSPRNG. */
function generatePin(): string {
    const { randomInt } = require('crypto') as typeof import('crypto');
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const iconPath = path.join(__dirname, 'iconTemplate.png');

const mb = menubar({
    // Served from public/ so the popover's sibling scripts resolve relatively.
    index: `file://${path.join(__dirname, 'public', 'tray-popover.html')}`,
    width: 300,
    height: 520,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    ...(process.platform === 'darwin' ? {
        vibrancy: 'under-window',
        visualEffectState: 'active'
    } : {}),
    webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
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
        // Surfaced in the popover instead of leaving it stuck on "Detecting...".
        startupError = err instanceof Error ? err.message : String(err);
        console.error('Failed to start server:', startupError);
    }
});

ipcMain.handle('get-connection-info', (): (ConnectionInfo & { pin: string; error?: string }) | null => {
    if (startupError) {
        return { url: '', pin: pairingPin, error: startupError };
    }
    if (!cachedUrl) return null;
    return {
        url: cachedUrl,
        qrCodeDataUrl: cachedQrCode || undefined,
        pin: pairingPin
    };
});

ipcMain.on('quit-app', () => {
    app.quit();
});
