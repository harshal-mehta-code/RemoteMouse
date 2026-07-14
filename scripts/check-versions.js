#!/usr/bin/env node

/**
 * Version Consistency Check
 *
 * Ensures that the version string is in sync across:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * Run as part of CI or manually: node scripts/check-versions.js
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

// 1. package.json
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pkgVersion = pkg.version;

// 2. tauri.conf.json
const tauriConf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")
);
const tauriVersion = tauriConf.version;

// 3. Cargo.toml — parse the first `version = "…"` after `[package]`
const cargoRaw = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoMatch = cargoRaw.match(/version\s*=\s*"([^"]+)"/);
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

if (!cargoVersion) {
  console.error("Could not find version in src-tauri/Cargo.toml");
  process.exit(1);
}

const versions = { "package.json": pkgVersion, "Cargo.toml": cargoVersion, "tauri.conf.json": tauriVersion };

const unique = new Set(Object.values(versions));

if (unique.size !== 1) {
  console.error("Version mismatch detected:");
  for (const [file, v] of Object.entries(versions)) {
    console.error(`  ${file}: ${v}`);
  }
  process.exit(1);
}

console.log(`All versions match: ${pkgVersion}`);
process.exit(0);
