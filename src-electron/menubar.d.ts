// Minimal type declaration for the 'menubar' package which ships no TypeScript types.
// Extend this as needed when using additional Menubar API surface.
declare module 'menubar' {
    import { BrowserWindow } from 'electron';

    interface MenubarOptions {
        index: string;
        width?: number;
        height?: number;
        resizable?: boolean;
        show?: boolean;
        frame?: boolean;
        transparent?: boolean;
        vibrancy?: string;
        visualEffectState?: string;
        webPreferences?: Record<string, unknown>;
        icon?: string;
        preloadWindow?: boolean;
        showDockIcon?: boolean;
        [key: string]: unknown;
    }

    interface Menubar {
        on(event: 'ready', listener: () => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
        window?: BrowserWindow;
    }

    function menubar(options?: MenubarOptions): Menubar;
    export = menubar;
}
