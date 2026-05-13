# RemoteMouse 🖱️📱

RemoteMouse transforms your iPhone (or any smartphone) into a high-precision, wireless trackpad for your Mac. Designed as a lightweight macOS menubar app, it allows you to control your cursor, click, scroll, and type remotely without installing any mobile apps.

## ✨ Features

- **Instant Connection:** No mobile app required. Just scan the QR code from the menubar popover.
- **Advanced Touch Controls:**
  - **Single Tap:** Left click.
  - **Two-Finger Tap:** Right click.
  - **Double Tap:** Standard double-click action.
  - **Long Press & Drag:** Long-press until the touchpad turns blue to grab and drag windows or files.
  - **Two-Finger Scroll:** Smooth vertical scrolling.
- **Remote Keyboard:** Type text directly from your phone to your Mac.
- **Native macOS Feel:** Frosted glass (vibrancy) UI, menubar integration, and Dark Mode support.
- **Secure & Local:** Works entirely over your local Wi-Fi network.

## 🚀 Getting Started

### Prerequisites

- **macOS:** Designed and tested for macOS.
- **Node.js:** Version 18 or higher.
- **Permissions:** The app requires **Accessibility** permissions to control the mouse. You will be prompted on the first run.

### Development

1. **Clone the repo:**
   ```bash
   git clone https://github.com/harshal-mehta-code/RemoteMouse.git
   cd RemoteMouse
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

## 📦 Building the App

Our build pipeline uses `esbuild` to bundle the entire app into a tiny ~30KB core before packaging.

1. **Generate the distributable (DMG):**
   ```bash
   npm run make
   ```

2. **Locate the installer:**
   The generated DMG will be in `out/make/RemoteMouse.dmg`.

## 🛠️ Tech Stack

- **Frontend:** HTML5 Touch API & Native WebSockets.
- **Backend:** Node.js, Native HTTP Server, Lightweight `ws` library.
- **Desktop Wrapper:** Electron & Menubar.
- **Bundling:** `esbuild` for ultra-fast, minified code delivery.
- **Automation:** RobotJS & `mouse-macos` for native hardware interaction.

## 📄 License

ISC License. Feel free to use and modify for personal or commercial projects.
