# Changelog

## 2026-05-06 1.2.1

### Added
- Added task Flight Recorder diagnostics for provider history, tool steps, read basis, transactions, and hook traces.
- Added workspace transaction records for worker file writes, edits, moves, and selected external side effects.
- Added transaction approval, rejection, rollback, and debug packet API routes for task inspection.
- Added regression coverage for transaction approval/apply behavior, stale read-basis protection, rollback, flight recorder packets, and architecture boundaries.
- Added `observer/package.json` release metadata and npm scripts for observer startup and regression runs.

### Changed
- Improved worker resume context with prior tool steps, applied transactions, and read-basis summaries.
- Improved project status responses to match specific project names from the user message.
- Improved task event sequencing for live observer event ordering.
- Improved developer tools with a Flight Recorder tab for inspecting task execution state.

### Fixed
- Prevented high-risk sandbox writes, edits, and moves from mutating files before approval.
- Prevented approved writes from applying over files changed after the transaction proposal.
- Fixed move transaction rollback so source files and overwritten destinations are restored correctly.
- Fixed external transaction approval so non-sandbox side effects are approved without being forced through sandbox apply.
- Fixed Flight Recorder UI encoding artifacts.

## 2026-04-29 1.2.0

### Added
- Added Home Assistant / IoT support with secure instance registry and token handling.
- Added worker tool integrations for IoT device listing, state queries, and Home Assistant service calls.
- Added voice invitation flow for waiting tasks, including yes/acknowledge acceptance and question time support.
- Added avatar scene addon extension points for custom visual effects and runtime integrations.
- Added runtime plugin lifecycle hook telemetry for queue and worker execution events.
- Added IoT/Home Assistant secret catalog support to `Secrets` UI via OS keychain handles.
- Updated README to document the new IoT feature set and secrets improvements.

### Changed
- Improved `Secrets` management documentation to include IoT token storage.
- Extended `Secrets` tab and plugin lifecycle description in the README.
