import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionInfo } from '../src-shared/types';

/**
 * Minimal, explicitly-enumerated bridge exposed to the tray popover.
 *
 * The popover renders remote-derived strings (the LAN URL), so it runs with
 * `contextIsolation: true` and `nodeIntegration: false`. Only these three
 * operations cross the boundary — the renderer never sees `ipcRenderer` itself.
 */
export interface RemoteMouseApi {
    /** Resolve the current connection URL, QR code, and pairing PIN. */
    getConnectionInfo(): Promise<(ConnectionInfo & { pin: string; error?: string }) | null>;
    /** Quit the application. */
    quit(): void;
}

const api: RemoteMouseApi = {
    getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),
    quit: () => ipcRenderer.send('quit-app'),
};

contextBridge.exposeInMainWorld('remoteMouseAPI', api);
