# Contributing to RemoteMouse

First of all, thank you for taking the time to contribute to **RemoteMouse**! 🎉

Whether you're fixing bugs, improving documentation, or implementing new features, every contribution is appreciated.

Please read this guide before getting started to ensure a smooth development and review process.

---

## Project Architecture

RemoteMouse uses a **dual-backend architecture**.

## `src-tauri/`

The primary desktop backend built with **Rust** and **Tauri v2**.

This is the recommended backend for most new development because it offers better performance and a smaller application size.

Use this directory when working on:

- Native desktop functionality
- Backend logic
- Tauri-specific features
- Performance improvements

---

## `src-electron/`

The legacy backend built with **TypeScript** and **Electron**.

Use this directory only when making Electron-specific fixes or maintaining compatibility with the Electron version of the application.

---

## `src-shared/`

Contains code shared by both desktop backends.

### `src-shared/public/`

This folder contains the shared frontend, including:

- HTML
- CSS
- Client-side TypeScript
- Shared UI assets

Most user interface changes should be made here so they work for both Tauri and Electron.

---

## Development Setup

## Prerequisites

Before running the project, install:

- Node.js (LTS)
- Rust (required for Tauri development)
- Visual Studio Build Tools (Windows, when required for native modules)

Clone the repository and install dependencies:

```bash
git clone https://github.com/harshal-mehta-code/RemoteMouse.git
cd RemoteMouse
npm install
```

---

## Running the Project

## Run the recommended Tauri backend

```bash
npm run tauri:dev
```

## Run the Electron backend

```bash
npm run electron:dev
```

---

## Choosing Where to Contribute

| Change Type | Location |
|--------------|----------|
| Tauri backend | `src-tauri/` |
| Electron backend | `src-electron/` |
| Shared frontend | `src-shared/public/` |
| Shared types | `src-shared/types.ts` |

If a change affects both desktop versions, prefer implementing it in the shared frontend whenever possible.

---

## Code Style

Please keep contributions clean and focused.

- Follow the existing project structure and coding style.
- Keep commits small and focused on a single issue.
- Avoid unrelated formatting or refactoring changes.
- Write clear commit messages.

---

## Reporting Issues

Before opening a new issue:

- Search existing issues to avoid duplicates.
- Include clear reproduction steps for bugs.
- Provide your operating system, backend (Tauri/Electron), and application version when applicable.

---

## Pull Request Guidelines

Before opening a pull request:

- Keep the pull request focused on one issue.
- Test your changes whenever possible.
- Update documentation if your changes affect usage or development.
- Link the related issue in your pull request description.
- Include screenshots for UI changes when appropriate.

---

## Need Help?

If you're unsure where to make a change or have questions about the project, feel free to open an issue before starting larger contributions.

We appreciate your time and effort in helping improve RemoteMouse.

Happy coding! 🚀