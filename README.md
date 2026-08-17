# 🖱️ RemoteMouse Pro
[![Release](https://github.com/harshal-mehta-code/RemoteMouse/actions/workflows/release.yml/badge.svg)](https://github.com/harshal-mehta-code/RemoteMouse/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/tag/harshal-mehta-code/RemoteMouse?label=version&color=blue)](https://github.com/harshal-mehta-code/RemoteMouse/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**RemoteMouse Pro** is a high-performance, cross-platform utility that transforms your smartphone into a premium wireless touchpad and keyboard for your computer. Built with a focus on low latency, modern aesthetics, and dual-backend flexibility.

---

## ✨ Features
- **🚀 Dual-Backend Architecture**: Choose between the ultra-lightweight **Tauri v2** version (Rust-based) or the feature-rich **Electron** legacy version.
- **🪄 Premium UI**: Modern glassmorphic popover design for macOS and Windows, with a responsive dark-mode mobile interface.
- **⚡ Ultra-Low Latency**: Optimized WebSocket communication for near-zero delay between touch and cursor movement.
- **📱 Mobile Optimized**:
  - **Fluid Touchpad**: Support for relative movement, left/right clicks, scrolling, pinch multi-touch and more.
  - **Keyboard Integration**: Type on your phone and watch it appear instantly on your computer.
- **🛡️ Secure & Local**: No internet required. All communication happens over your local Wi-Fi, gated behind a 6-digit pairing PIN with brute-force lockout and idle session expiry.

---

## 🚀 Getting Started

### 1. Download & Install
Download the latest version for your platform from the [Releases](https://github.com/harshal-mehta-code/RemoteMouse/releases) page.
- **Tauri Version**: Recommended for performance and small size (~5MB).
- **Electron Version**: Provided for legacy compatibility.

### 2. Connect
1. Launch **RemoteMouse Pro** on your computer.
2. Click the tray icon to reveal the connection QR Code.
3. Scan the QR code with your phone (ensure you are on the same Wi-Fi).
4. Enter the 6-digit pairing PIN shown in the popover.
5. Start controlling!

> **macOS:** the first launch asks for **Accessibility** permission. Without it the
> app connects normally but cannot move the cursor — grant it under
> *System Settings > Privacy & Security > Accessibility*, then restart the app.

---

## ⚠️ Common Issues & Troubleshooting

### macOS "App is damaged and can't be opened"
If you download the `.dmg` release directly from GitHub using a web browser, macOS attaches a strict quarantine flag to the file. Since this app is open-source and not signed with a paid Apple Developer certificate, macOS Gatekeeper may show an error stating the app is **"damaged and should be moved to the Trash."**

**This is entirely normal for unsigned apps.** To bypass this and safely open the app:
1. Drag `RemoteMouse.app` into your `/Applications` folder.
2. Open the **Terminal** application.
3. Run the following command to clear the quarantine flag:
   ```bash
   xattr -cr /Applications/RemoteMouse.app
   ```
4. You can now launch the app normally!

---

## 🛠️ Development

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rust-lang.org/) (for Tauri builds)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows only, for RobotJS)

### Setup
```bash
# Clone the repository
git clone https://github.com/harshal-mehta-code/RemoteMouse.git
cd RemoteMouse

# Install dependencies
npm install
```

### Run in Development Mode
```bash
# Run Tauri (Recommended)
npm run tauri:dev

# Run Electron
npm run electron:dev
```

### Tests & Checks
```bash
npm test          # Node + Rust test suites
npm run typecheck # TypeScript, no emit
```

---

## 📂 Project Structure
```text
├── assets/             # Branding and icons
├── src-tauri/          # Rust backend (Tauri v2)
├── src-electron/       # TypeScript backend (Electron)
├── src-shared/         # Common frontend and types
├── tests/              # Node test suite (node:test)
└── .github/            # Automated CI/CD workflows
```

---

## 📝 License
Distributed under the MIT License. See `LICENSE` for more information.

---
