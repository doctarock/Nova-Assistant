# Observer Plugin System Developer Guide

## 1. Purpose and Scope

This is the canonical developer reference for Observer plugins.

Use this guide when you want to:

- Create a new plugin
- Move existing core features into plugins
- Expose plugin UI (control panels and full tabs)
- Persist plugin data safely inside the main runtime
- Integrate with subsystem hooks (intake, queue, mail, cron, etc.)
- Hardening-check a local plugin deployment

Design goals of the plugin system:

- Optionality: Observer runs with plugins disabled or missing
- Isolation by convention: plugin-owned capabilities, hooks, data, and UI
- Progressive extensibility: add behavior without patching core every time
- Operational safety: plugin failures should not crash core server startup
- Deterministic composition: hook/capability priority and stable execution order
- Runtime observability: per-plugin and per-hook execution metrics

## 2. Runtime Model

Observer plugin runtime is in-process and loaded at startup.

High-level sequence:

1. Discover plugin modules
2. Load plugin objects
3. Validate/normalize manifests
4. Build plugin API surface per plugin
5. Run `init(api)` for enabled plugins
6. Register plugin routes via `registerRoutes(...)`
7. Expose plugin metadata via plugin APIs/UI

If plugin loading fails, Observer falls back to a no-op plugin manager and continues serving core endpoints.

## 3. No-Plugin Mode and Safety Fallbacks

Observer supports full operation without plugins.

- Set `OBSERVER_DISABLE_PLUGINS=1` to disable loading
- Failed plugin runtime initialization falls back to no-op manager
- `GET /api/plugins/list` still returns a stable shape
- If a previously known plugin file disappears, Observer auto-disables that plugin in persisted state
- If the file later reappears, the plugin stays disabled until manually re-enabled

Expected no-plugin list payload includes:

- `disabled: true`
- `plugins: []`
- `tools: []`
- `uiPanels: []`
- `uiTabs: []`
- `loadErrors: [...]` when applicable

## 4. Discovery and Loading

### 4.1 Built-in plugin files

Built-ins are loaded first from `server/plugins/*-plugin.js`.

Current built-ins:

- `security-plugin.js`
- `task-lifecycle-plugin.js`
- `session-memory-plugin.js`

### 4.2 Auto-discovered plugin files

Observer then discovers additional plugin modules from:

1. `server/plugins`
2. `.derpy-observer-runtime/plugins-runtime/modules`
3. each directory in `OBSERVER_PLUGIN_DIR`

`OBSERVER_PLUGIN_DIR` path delimiter:

- Windows: `;`
- Linux/macOS: `:`

Discovery is recursive and matches:

- `*-plugin.js`
- `*-plugin.mjs`
- `*-plugin.cjs`

### 4.3 Folder-based plugin packaging

Plugins can live in folders with multiple files.

Recommended layout:

```text
server/plugins/<plugin-id>/
  <plugin-id>-plugin.js
  lib/
  public/
  README.md
```

Only the `*-plugin.*` entrypoint is required for discovery. Everything else is up to the plugin.

### 4.4 UI upload and installation

Observer can install local plugin packages from the Plugins UI.

Supported upload formats:

- single-file entrypoints: `.js`, `.mjs`, `.cjs`
- zip packages containing exactly one `*-plugin.js`, `*-plugin.mjs`, or `*-plugin.cjs` entrypoint

Upload behavior:

- packages are installed into `.derpy-observer-runtime/plugins-runtime/modules/<plugin-id>/`
- uploaded plugins are treated as runtime modules, not built-in plugins
- uploaded plugins are written disabled by default
- Observer must be restarted before the uploaded module is discovered
- after restart, the plugin must be enabled manually from the Plugins UI
- the UI can request an automatic restart after install, but only when Observer is running under a restart supervisor such as PM2

This keeps activation explicit even when plugin files are added automatically.

## 5. Plugin Contract

A plugin module should export a factory function returning a plugin object:

- `id` (stable slug)
- `name` (human label)
- `version`
- `description`
- `manifest` (required)
- `init(api)` (optional)
- `registerRoutes({ app, fs, path, runtimeRoot, plugin, api })` (optional)

Example skeleton:

```js
export function createExamplePlugin(options = {}) {
  return {
    id: "example",
    name: "Example",
    version: "1.0.0",
    description: "Example plugin.",
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        tools: ["example_ping"],
        capabilities: ["example.ping"],
        hooks: ["subsystem:queue:request-completed"],
        runtimeContext: ["noteInteractiveActivity"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      api.provideCapability("example.ping", async () => ({ ok: true, at: Date.now() }));
    }
  };
}
```

## 6. Manifest Reference

Manifest is mandatory.

Top-level keys:

- `schemaVersion`
- `permissions`
- `compatibility` (optional but recommended)
- `dependencies`
- `security`

### 6.1 `permissions`

Current permission areas:

- `routes`: allow `registerRoutes`
- `uiPanels`: allow `registerUiPanel` and `registerUiTab`
- `data`: allow `api.data.*`
- `tools`: allowed tool names plugin may register with `api.registerTool`
- `capabilities`: allowed capability names plugin may provide
- `hooks`: allowed hook names plugin may subscribe to
- `runtimeContext`: allowlisted runtime-context keys plugin may read/write

If a plugin attempts disallowed capability/hook/UI registration, it is blocked and recorded as plugin failure metadata.

### 6.2 `dependencies`

Dependency declarations:

- `requiredCapabilities`: capability names that must exist
- `optionalCapabilities`: capability names plugin can use if present

Use optional dependencies for soft integrations (for example, finance plugin reacting to mail availability).

### 6.3 `compatibility`

Compatibility declarations:

- `compatibility.coreApiMin`
- `compatibility.coreApiMax`

If the running core plugin API version is outside this range, plugin load is blocked and surfaced in plugin failure metadata.

### 6.4 `security`

Declared security mode currently supports:

- `isolation: "inprocess"` (active runtime mode)

`"process"` may be declared for forward compatibility, but process isolation is not implemented yet.

## 7. Plugin API (`init(api)`) Reference

Available API methods:

- `api.registerTool(toolDescriptor)`
- `api.coreApiVersion` / `api.getCoreApiVersion()`
- `api.provideCapability(name, handler, options?)`
- `api.addHook(name, handler, options?)`
- `api.registerUiPanel(panelDescriptor)`
- `api.registerUiTab(tabDescriptor)`
- `api.getRuntimeContext()`
- `api.setRuntimeContext(partialContext)`
- `api.getCapability(name)`
- `api.listCapabilityProviders(name)`
- `api.runHook(name, payload)`
- `api.broadcast(message)`
- `api.getObserverConfig()`
- `api.isEnabled()`
- `api.setEnabled(enabled)`
- `api.data.path(key, options?)`
- `api.data.readJson(key, fallback?)`
- `api.data.writeJson(key, value)`
- `api.data.updateJson(key, updater, fallback?)`

Notes:

- `api.registerTool` adds plugin-owned tools into the unified intake/worker tool catalog used by prompts, approvals, and the Tools UI.
- `options.priority` is supported on `provideCapability` and `addHook` (lower runs first; default `100`).
- `api.runHook` executes enabled handlers in deterministic order: `priority`, then registration order.
- Hook handlers can return a modified payload. Returned value becomes next handler input.
- Returning `undefined` keeps payload unchanged.
- Hook failures are isolated: one plugin hook failing does not abort the hook pipeline.
- Hook execution timeout defaults to `12000ms` and is configurable by `OBSERVER_PLUGIN_HOOK_TIMEOUT_MS`.

## 8. Data Persistence Model

Plugin data is persisted under the main runtime tree and survives enable/disable cycles.

Base path:

- `.derpy-observer-runtime/plugins-runtime/data/<plugin-id>/`

Guidelines:

- Prefer `api.data.readJson` / `writeJson` / `updateJson` over ad-hoc file writes.
- Keep plugin schemas versioned internally if you expect evolution.
- Treat disabled plugin state as dormant, not deleted.
- Never assume companion plugins are present; degrade gracefully.

Example:

```js
const state = await api.data.readJson("ledger", { version: 1, entries: [] });
state.entries.push(newEntry);
await api.data.writeJson("ledger", state);
```

## 9. Hooks and Eventing

### 9.1 Core lifecycle hooks

Current core hooks include:

- `plugins:initialized`
- `plugin:lifecycle:changed`
- `plugin:lifecycle:enabled`
- `plugin:lifecycle:disabled`
- `permissions:decision`
- `queue:task-dispatch-started`
- `queue:task-processed`
- `queue:batch-started`
- `queue:batch-processed`
- `cron:tick-started`
- `cron:tick-completed`
- `runtime:startup`
- `runtime:tick:cron`
- `runtime:tick:5m`

### 9.2 Global request hooks

Observer emits request lifecycle hooks for all API/event groups:

- `http:request-started`
- `http:request-completed`
- `subsystem:<name>:request-started`
- `subsystem:<name>:request-completed`

Current subsystem names include:

- `intake`
- `queue`
- `cron`
- `mail`
- `runtime`
- `events`
- `output`
- `tests`
- `tools`
- `secrets`
- `plugins`
- `brains`
- `config`
- `voice`
- `trust`
- `avatar`
- `api`
- `admin`

### 9.3 Additional subsystem hooks

Examples:

- Event relay:
  - `observer:event`
  - `observer:event:<event-type>`
  - `subsystem:<name>:event`
- Intake decision points:
  - `subsystem:intake:triage-started`
  - `subsystem:intake:triage-completed`
  - `subsystem:intake:triage-failed`
- Voice annotation:
  - `subsystem:voice:response-annotated`

### 9.4 Cross-plugin contracts using hooks

Recommended pattern for extensibility:

- Producer plugin emits a namespaced hook and stable payload shape.
- Consumer plugins subscribe via `api.addHook`.
- Producer remains functional even with zero subscribers.

Naming guidance:

- Use low-collision namespaced hooks, for example `finance:entry-upserted`.
- Document payload contract in plugin README.

## 10. Capabilities (Service Contracts)

Capabilities are direct callable contracts.

Pattern:

- Provider: `api.provideCapability("capability.name", handler)`
- Consumer: `const fn = api.getCapability("capability.name")`
- Guard call: `if (typeof fn === "function") { ... }`

Use capabilities when:

- You need request/response behavior
- Ordering is controlled by caller
- You do not need multi-subscriber fanout

Use hooks when:

- You want event-style fanout
- Multiple plugins may react independently

## 11. UI Integration

There are two plugin UI surfaces.

### 11.1 Plugin UI Panels (`registerUiPanel`)

Panels are rendered inside Plugins view.

Fields:

- `text`
- `number`
- `checkbox`
- `textarea`

Action descriptors support:

- `method`
- `endpoint`
- `queryFields`
- `bodyFields`
- `staticBody`
- `expects` (`json` or `text`)
- `confirm` (optional)

### 11.2 Top-level tabs (`registerUiTab`)

Use `registerUiTab` for full plugin-managed pages.

Tab descriptor fields:

- `id`
- `title`
- `icon`
- `order`
- `scriptUrl`

`scriptUrl` should point to a route serving an ES module. That module should export a mount function used by core frontend loader.

Important routing note:

- Routes under `/api/plugins/*` are admin-token protected.
- Public UI module script routes should use a non-admin path (for example `/api/plugin-ui/<plugin>/tab.js`) so browser `import()` works without admin headers.

## 12. Tool Integration Pattern

Observer now supports plugin-owned tool descriptors as first-class registry entries.

- Core tools still live in core catalogs.
- Plugin-owned tools should be declared in the plugin that owns the behavior using `api.registerTool(...)`.
- The unified tool catalog merges core tools plus enabled plugin tools across `intake` and `worker` scopes.
- Tool approvals in `/api/tools/config` apply to both core and plugin-owned tools.

Recommended plugin approach:

1. Register the tool metadata with `api.registerTool(...)`.
2. Implement execution via capabilities, routes, or `intake:tool-call` hooks as appropriate.
3. Keep the tool descriptor and execution path in the same plugin so ownership stays explicit.

Hooks are still useful for execution and telemetry, but they should no longer be the primary source of tool metadata.

## 13. Security Model and Hardening

### 13.1 Admin controls

`/api/plugins/*` requires:

- trusted local origin
- valid `x-admin-token`

### 13.2 Runtime context scoping

Plugins only access runtime context keys allowed by manifest.

### 13.3 Data sandboxing

Plugin data APIs are scoped by plugin id and stored in plugin-owned runtime paths.

### 13.4 Audit trail

Plugin route/data/toggle activity is appended to:

- `plugins-runtime/plugin-audit.log`

### 13.5 Trust policy

Optional trust policy file:

- `plugins-runtime/plugin-trust.json`

Supports allowlist mode by plugin hash.

### 13.6 Local deployment posture

For local-only trusted code, this model is generally reasonable.

For stronger isolation:

- treat all third-party plugins as untrusted by default
- enable trust allowlisting
- keep plugin route exposure minimal
- avoid granting unnecessary manifest permissions
- prefer read-only operations where possible

## 14. WordPress-Style Header Comment (Recommended)

Use a descriptive header comment in each plugin entry file.

```js
/**
 * Plugin Name: Example Operations
 * Plugin Slug: example-operations
 * Description: Example plugin for queue diagnostics and utility APIs.
 * Version: 1.0.0
 * Author: OpenClaw Observer
 * Observer UI Panel: Yes
 */
```

This improves discoverability and maintenance for human operators.

## 15. End-to-End Example Plugin

```js
/**
 * Plugin Name: Example Operations
 * Plugin Slug: example-operations
 * Description: Example plugin for queue diagnostics and utility APIs.
 * Version: 1.0.0
 * Author: OpenClaw Observer
 * Observer UI Panel: Yes
 */

export function createExampleOperationsPlugin() {
  return {
    id: "example-operations",
    name: "Example Operations",
    version: "1.0.0",
    description: "Example plugin.",
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        tools: ["example_ping"],
        capabilities: ["example.ping"],
        hooks: ["subsystem:queue:request-completed"],
        runtimeContext: ["noteInteractiveActivity"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      api.registerTool({
        name: "example_ping",
        description: "Run a simple example ping action.",
        scopes: ["intake"],
        risk: "normal"
      });

      api.provideCapability("example.ping", async () => ({ ok: true, at: Date.now() }));

      api.addHook("subsystem:queue:request-completed", async (payload = {}) => payload);

      api.registerUiPanel({
        id: "example-ops",
        title: "Example Ops",
        description: "Run demo plugin actions.",
        fields: [
          { id: "task_id", label: "Task ID", type: "text", placeholder: "task-123" }
        ],
        actions: [
          {
            id: "ping",
            label: "Ping",
            method: "GET",
            endpoint: "/api/plugins/example/ping",
            expects: "json"
          }
        ]
      });
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugins/example/ping", async (_req, res) => {
        const ping = api.getCapability("example.ping");
        const payload = typeof ping === "function" ? await ping() : { ok: false };
        res.json({ ok: true, plugin: "example-operations", ...payload });
      });
    }
  };
}
```

## 16. API Inspection and Operations

Useful plugin operations:

- `GET /api/plugins/list`
- `GET /api/plugins/state`
- `POST /api/plugins/:pluginId/toggle` body `{ "enabled": true|false }`
- `GET /api/plugins/trust`
- `POST /api/plugins/trust`

List response includes:

- loaded plugin inventory
- plugin-owned tools
- capabilities and providers
- hooks and providers
- plugin routes
- plugin failures
- aggregated `uiPanels`
- aggregated `uiTabs`

## 17. Troubleshooting

### 17.1 Plugin does not load

Check:

- filename matches `*-plugin.js|mjs|cjs`
- plugin entry exports a factory
- manifest exists and is valid
- plugin id is unique and stable
- if the plugin was newly uploaded, restart Observer before expecting discovery
- if the plugin was previously missing or just uploaded, confirm it is manually enabled after restart

### 17.2 Hook registration silently missing

Check manifest `permissions.hooks` contains exact hook name.

### 17.3 Capability not visible to consumer

Check:

- provider plugin enabled
- capability declared in provider `permissions.capabilities`
- consumer checks `typeof fn === "function"` before call

### 17.4 Tab script fails to import in browser

Likely admin-protected route mismatch.

Fix:

- serve tab module from non-admin path like `/api/plugin-ui/<plugin>/tab.js`
- keep plugin control routes under `/api/plugins/*`

### 17.5 Data appears lost when plugin disabled

Normally expected behavior is dormant, not deleted.

Verify plugin reads same data key/path after re-enable and schema normalization did not drop old fields.

## 18. Recommended Practices

- Keep plugin IDs immutable.
- Use namespaced hook and capability names.
- Design for absent optional dependencies.
- Keep payload contracts documented and compact.
- Validate and normalize external inputs in routes.
- Do not let plugin hook failures block core critical paths.
- Prefer additive migrations over destructive rewrites.

## 19. Changelog Discipline for Plugin Authors

For each plugin release, record:

- manifest permission changes
- hook/capability contract changes
- data schema migrations
- new or removed routes
- UI tab/panel changes

This keeps multi-plugin environments operable as features move from core into plugins.
