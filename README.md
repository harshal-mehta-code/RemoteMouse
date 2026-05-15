# RemoteMouse 🖱️📱

RemoteMouse transforms your smartphone into a high-precision, wireless trackpad for your Mac or Windows PC. It allows you to control your cursor, click, scroll, and type remotely without installing any mobile apps.

---

### 📥 [**Download the Latest Release**](https://github.com/harshal-mehta-code/RemoteMouse/releases/latest)
*Just download, run, and you're ready to go!*

---

## ✨ Features

- **Cross-Platform:** Full support for **macOS** and **Windows**.
- **Instant Connection:** No mobile app required. Just scan the QR code from the tray/menubar popover.
- **Advanced Touch Controls:**
  - **Single Tap:** Left click.
  - **Two-Finger Tap:** Right click.
  - **Double Tap:** Standard double-click action.
  - **Long Press & Drag:** Long-press until the touchpad turns blue to grab and drag windows or files.
  - **Two-Finger Scroll:** Smooth vertical scrolling.
- **Remote Keyboard:** Type text directly from your phone to your PC.
- **Modern UI:** Integrated tray icon, QR pairing, and responsive web client.
- **Smart Networking:** Automatically detects your local IP and ignores VPN interfaces (NordVPN, etc.).

## 🚀 Getting Started

### Installation
- **Windows:** Download the zip from the [Releases](https://github.com/harshal-mehta-code/RemoteMouse/releases) page, extract it, and run `RemoteMouse.exe`.
- **macOS:** Download the `.dmg`, open it, and drag the app to your Applications folder.

### Prerequisites (For Developers)
- **Node.js:** Version 18 or higher.
- **Windows Build Tools:** Required for `robotjs`. Run `npm install --global windows-build-tools` or install C++ tools via Visual Studio.
- **Permissions:** 
  - **macOS:** Requires **Accessibility** permissions (prompted on first run).
  - **Windows:** May require Firewall permission to allow local network communication.

## 🛠️ Tech Stack

- **Frontend:** HTML5 Touch API & Native WebSockets.
- **Backend:** Node.js, Native HTTP Server, Lightweight `ws` library.
- **Desktop Wrapper:** Electron & Menubar.
- **Bundling:** `esbuild` for ultra-fast, minified code delivery.
- **Automation:** RobotJS for native hardware interaction.

## 📄 License

ISC License. Feel free to use and modify for personal or commercial projects.
