# Codex Notes

- When a user reports a live UI bug, do not claim it is fixed based on backend persistence, API-only verification, or a manual state change made by the assistant.
- Do not change user settings or checkbox state as a substitute for proving the UI path is fixed.
- Verify the exact user-facing path first: loaded frontend code, event wiring, save payload, persisted result, and refresh behavior.
- Be explicit about actions taken. Never imply a user-driven verification happened when the assistant changed state directly.
