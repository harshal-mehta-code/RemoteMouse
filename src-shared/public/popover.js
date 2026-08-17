/**
 * Tray popover controller, shared by the Tauri and Electron backends.
 *
 * Loaded as an external script (never inline) so the page can run under a
 * strict Content-Security-Policy with no `unsafe-inline` for scripts.
 */
(function () {
    'use strict';

    var urlText = document.getElementById('url-text');
    var pinEl = document.getElementById('pin');
    var qrContainer = document.getElementById('qrcode');
    var errorLog = document.getElementById('error-log');

    function displayError(msg) {
        if (!errorLog) return;
        errorLog.textContent = String(msg);
        errorLog.style.display = 'block';
    }

    function updateUI(url, qrDataUrl, pin) {
        urlText.textContent = url;
        if (pin) pinEl.textContent = pin;

        qrContainer.textContent = '';
        if (qrDataUrl) {
            var img = document.createElement('img');
            img.src = qrDataUrl;
            img.width = 150;
            img.height = 150;
            qrContainer.appendChild(img);
        } else if (window.QRCode) {
            new window.QRCode(qrContainer, { text: url, width: 150, height: 150 });
        }
    }

    // --- Backend adapters -------------------------------------------------

    async function initTauri(tauri) {
        var invoke = tauri.core ? tauri.core.invoke : tauri.invoke;

        var getCurrentWindow = tauri.window ? tauri.window.getCurrentWindow : null;
        if (getCurrentWindow) {
            var appWindow = getCurrentWindow();
            if (appWindow && appWindow.listen) {
                appWindow.listen('tauri://blur', function () {
                    appWindow.hide().catch(console.error);
                });
            }
        }

        if (!invoke) return;
        try {
            var info = await invoke('get_connection_info');
            if (info.error) {
                displayError(info.error);
                urlText.textContent = 'Unavailable';
                if (info.pin) pinEl.textContent = info.pin;
                return;
            }
            updateUI(info.url, null, info.pin);
        } catch (err) {
            displayError(err);
        }

        // Warn when the OS has not granted the permission needed to move the
        // cursor — without this the app looks connected but does nothing.
        try {
            if ((await invoke('check_accessibility')) === false) {
                displayError('Grant Accessibility permission in System Settings > Privacy & Security, then restart RemoteMouse.');
            }
        } catch (err) {
            /* Command unavailable on this platform — not fatal. */
        }
    }

    async function initElectron(api) {
        try {
            var info = await api.getConnectionInfo();
            if (!info) {
                displayError('Starting server...');
                return;
            }
            if (info.error) {
                displayError(info.error);
                urlText.textContent = 'Unavailable';
                pinEl.textContent = info.pin;
                return;
            }
            updateUI(info.url, info.qrCodeDataUrl, info.pin);
        } catch (err) {
            displayError(err);
        }
    }

    function detectBackend() {
        if (window.__TAURI__) return initTauri(window.__TAURI__);
        if (window.remoteMouseAPI) return initElectron(window.remoteMouseAPI);
        return null;
    }

    if (!detectBackend()) {
        // Either bridge may attach slightly after first paint.
        var attempts = 0;
        var timer = setInterval(function () {
            if (detectBackend() || ++attempts > 20) {
                clearInterval(timer);
                if (attempts > 20) displayError('Connection failed.');
            }
        }, 100);
    }

    // --- UI wiring --------------------------------------------------------

    document.getElementById('url').addEventListener('click', async function () {
        var text = urlText.textContent;
        if (!text || text === 'Detecting...' || text === 'Unavailable') return;
        try {
            await navigator.clipboard.writeText(text);
            urlText.textContent = 'Copied!';
            setTimeout(function () { urlText.textContent = text; }, 1500);
        } catch (err) {
            displayError('Could not copy to clipboard.');
        }
    });

    document.getElementById('quit-btn').addEventListener('click', async function () {
        var tauri = window.__TAURI__;
        if (tauri) {
            var invoke = tauri.core ? tauri.core.invoke : tauri.invoke;
            if (invoke) { await invoke('quit_app'); return; }
        }
        if (window.remoteMouseAPI) window.remoteMouseAPI.quit();
        else window.close();
    });
})();
