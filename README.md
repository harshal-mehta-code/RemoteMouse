# RemoteMouse 🖱️📱

RemoteMouse transforms your smartphone into a high-precision, wireless trackpad for your Mac or Windows PC. Control your cursor, click, scroll, and type remotely without installing any mobile apps.

---

### 📥 [**Download the Latest Release**](https://github.com/harshal-mehta-code/RemoteMouse/releases/latest)
*The new **v2.0 (Tauri)** release is now available—dropping the app size from **120MB** to just **7MB**!*

---

## ✨ Features

- **High Performance:** v2 is built with **Rust**, featuring a dedicated input worker for zero-lag control.
- **Ultra-Lightweight:** 94% smaller footprint compared to traditional Electron apps.
- **Instant Connection:** No mobile app required. Just scan the QR code.
- **Advanced Touch Controls:**
  - **Single Tap:** Left click.
  - **Two-Finger Tap:** Right click.
  - **Double Tap:** Double-click.
  - **Long Press & Drag:** Long-press until blue to grab and drag.
  - **Two-Finger Scroll:** Smooth vertical scrolling.
- **Remote Keyboard:** Type text directly from your phone.

## 🛠️ Tech Stacks

RemoteMouse now supports two backends. **Tauri (v2)** is the recommended version for performance and size.

### 🦀 Tauri v2 (Recommended)
- **Backend:** Rust (Axum, Enigo, Tokio)
- **Size:** ~7 MB
- **Performance:** Native thread-level input control.

### ⚛️ Electron (Legacy)
- **Backend:** Node.js (Express, RobotJS, Menubar)
- **Size:** ~120 MB
- **Compatibility:** Traditional desktop wrapper.

---

## 🚀 Development

### Prerequisites
- **Node.js:** v18+
- **Rust:** (For Tauri version) [Install Rust](https://rustup.rs/)

### Running Locally

#### Tauri Version (v2)
```bash
npm run tauri:dev
```

#### Electron Version
```bash
npm run electron:dev
```

### Packaging / Building

#### Build Tauri (.dmg / .app)
```bash
npm run tauri:build
```

#### Build Electron (Make)
```bash
npm run electron:make
```

## 📄 License

ISC License. Feel free to use and modify for personal or commercial projects.
