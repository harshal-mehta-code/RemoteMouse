# Contributing to RemoteMouse Pro

Thanks for your interest in improving RemoteMouse. This document covers what you
need to know to get a change merged.

## Getting set up

**Prerequisites**

- [Node.js](https://nodejs.org/) LTS
- [Rust](https://rust-lang.org/) stable — for the Tauri backend
- Platform build tools for the native input libraries:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

```bash
git clone https://github.com/harshal-mehta-code/RemoteMouse.git
cd RemoteMouse
npm install
```

`robotjs` has no prebuilt binaries and compiles from source during install, so
the platform build tools above are required even if you only work on the Tauri
backend.

**Run it**

```bash
npm run tauri:dev      # Tauri backend (recommended)
npm run electron:dev   # Electron backend (legacy)
```

On macOS the app needs **Accessibility** permission to move the cursor. You will
be prompted on first launch; grant it under *System Settings > Privacy &
Security > Accessibility*, then restart the app.

## Before you open a PR

```bash
npm run typecheck   # TypeScript
npm test            # Node + Rust test suites
```

CI runs these plus `cargo clippy -D warnings` and a frontend build, so a green
local run should mean a green PR.

## Architecture in one minute

Two backends share one mobile web client:

| Path | What it is |
| --- | --- |
| `src-tauri/` | Rust backend (Tauri v2) — axum HTTP + WebSocket server, `enigo` for input |
| `src-electron/` | TypeScript backend (Electron) — `ws` server, `robotjs` for input |
| `src-shared/public/` | The mobile client and tray popover, shared by both backends |
| `tests/` | Node test suite (`node:test`) |

Both backends implement the same `MouseController` interface (`MouseController`
trait in Rust, `MouseController` interface in TypeScript) and speak the same
JSON WebSocket protocol defined in `src-shared/types.ts`. **A protocol change
must be made in both backends**, or one of them silently ignores the event.

## Things that will get a PR sent back

**Cross-platform parity.** Every gesture must work on macOS *and* Windows. Input
synthesis differs substantially per OS, and a change validated only on your dev
machine can silently no-op on the other platform — which is worse than an
obvious failure, because nobody notices. Where parity is genuinely impossible,
degrade to meaningful behaviour and document why. Never fail silently.

You can compile-check the other platform without a Windows machine:

```bash
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

(A full Tauri Windows *build* additionally needs `llvm-rc`; CI covers that.)

**Verify input mechanisms, don't reason about them.** OS input APIs are full of
surprises — `enigo`'s macOS backend sets modifier flags on no events at all, and
macOS silently discards synthesized magnify gestures. If a mechanism doesn't
work, write a throwaway binary that tries each candidate and observe which one
actually works, rather than shipping successive guesses. Record the dead ends in
a comment so the next person doesn't retry them.

**Input runs on a worker thread, so avoid main-thread-only OS APIs.** Every
event is dispatched on a dedicated input thread, never the UI thread. Some OS
input APIs assert they are on the main dispatch queue and **abort the process**
when they are not — `enigo`'s `Key::Unicode` is one, because it resolves the
character through Carbon's input-source APIs, which killed the app on every
pinch with an `EXC_BREAKPOINT` out of `dispatch_assert_queue`. Prefer APIs that
take a physical keycode (`Keyboard::raw`) over ones that consult the active
keyboard layout. A standalone test binary will not always reproduce this: the
assertion only fires once the host app has fully initialised the framework.

**Untrusted input.** The server is reachable by anything on the local network.
Every WebSocket message is schema-validated and size-capped before it reaches
the OS input layer; new events must be validated in **both** `validation.ts` and
`parse_event` in `network.rs`. Never widen a path or key allowlist without
thinking about what a hostile device on the same Wi-Fi could do with it.

## Commits

Conventional-commit prefixes (`fix:`, `feat:`, `chore:`, `docs:`, `test:`), and
explain *why* in the body, not just what. Scope commits so one can be reverted
without dragging unrelated changes with it.

## Reporting bugs

Include your OS and version, which backend (Tauri or Electron), the phone/browser
you connected from, and what you expected versus what happened. For input bugs,
say which app you were controlling — zoom and scroll behave differently in native
apps versus browsers.
