## What and why

<!-- What does this change, and what problem does it solve? -->

## Testing

<!-- How did you verify this? For input changes, say which apps you tested in. -->

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes

## Cross-platform

Input synthesis differs per OS, so a change validated on one platform can
silently no-op on the other.

- [ ] Works on macOS, or is not platform-specific
- [ ] Works on Windows, or is not platform-specific
- [ ] If parity isn't possible, the degraded behaviour is meaningful and documented

## Protocol changes

- [ ] Not applicable
- [ ] New/changed WebSocket events are implemented **and validated** in both
      `src-electron/server/validation.ts` and `parse_event` in
      `src-tauri/src/network.rs`
