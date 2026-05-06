/**
 * Plugin Name: Developer Tools
 * Plugin Slug: developer-tools
 * Description: Combines Hook Explorer, Prompt Review, and State Browser into a single developer plugin.
 * Version: 1.0.0
 * Author: OpenClaw Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Hook Explorer helpers ────────────────────────────────────────────────────

function normalizeNumber(value = 0, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function compactText(value = "", maxLength = 260) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sanitizeHookToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizePayload(value = null, depth = 0) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return compactText(value, 500);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) {
      return `array:${value.length}`;
    }
    if (typeof value === "object") {
      return `object:${Object.keys(value).length}`;
    }
    return compactText(String(value), 120);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizePayload(entry, depth + 1));
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 40);
    return Object.fromEntries(
      keys.map((key) => [key, sanitizePayload(value[key], depth + 1)])
    );
  }
  return compactText(String(value), 120);
}

function inferSubsystem(payload = {}) {
  const subsystem = sanitizeHookToken(payload?.subsystem || "");
  if (subsystem) {
    return subsystem;
  }
  const subsystems = Array.isArray(payload?.subsystems)
    ? payload.subsystems.map((entry) => sanitizeHookToken(entry)).filter(Boolean)
    : [];
  if (subsystems.length === 1) {
    return subsystems[0];
  }
  if (subsystems.length > 1) {
    return "multiple";
  }
  return "";
}

function normalizeHookSummary(hookName = "", payload = {}) {
  const hook = String(hookName || "").trim();
  const method = compactText(String(payload?.method || "").trim(), 12);
  const path = compactText(String(payload?.path || "").trim(), 180);
  const eventType = compactText(String(payload?.type || "").trim(), 120);
  if (hook.startsWith("http:request-")) {
    const statusCode = Number(payload?.statusCode || 0);
    if (hook.endsWith("started")) {
      return compactText(`${hook} ${method} ${path}`.trim(), 260);
    }
    return compactText(
      `${hook} ${method} ${path} ${statusCode || ""} ${Number(payload?.durationMs || 0) || 0}ms`.trim(),
      260
    );
  }
  if (hook.startsWith("observer:event")) {
    return compactText(`${hook} ${eventType}`.trim(), 260);
  }
  return compactText(`${hook} ${eventType || path || ""}`.trim(), 260);
}

// ─── Plugin factory ───────────────────────────────────────────────────────────

export function createDeveloperToolsPlugin(options = {}) {
  const {
    pluginId = "developer-tools",
    pluginName = "Developer Tools",
    description = "Hook Explorer, Prompt Review, and State Browser in one plugin.",
    maxEvents = 1200
  } = options;

  // Hook Explorer state
  const normalizedMaxEvents = normalizeNumber(maxEvents, 1200, 200, 10_000);
  let sequence = 0;
  let droppedCount = 0;
  const events = [];
  const hookCounts = new Map();
  const subscribedHooks = new Set();

  function recordHookEvent(hookName = "", payload = {}) {
    const hook = String(hookName || "").trim();
    if (!hook) {
      return;
    }
    if (
      hook.startsWith("http:request-")
      && String(payload?.path || "").trim().startsWith("/api/plugins/hook-explorer")
    ) {
      return;
    }
    sequence += 1;
    hookCounts.set(hook, Number(hookCounts.get(hook) || 0) + 1);
    const event = {
      id: `hook-${Date.now().toString(36)}-${sequence.toString(36)}`,
      at: Date.now(),
      hook,
      subsystem: inferSubsystem(payload),
      summary: normalizeHookSummary(hook, payload),
      payload: sanitizePayload(payload)
    };
    events.push(event);
    if (events.length > normalizedMaxEvents) {
      const overflow = events.length - normalizedMaxEvents;
      events.splice(0, overflow);
      droppedCount += overflow;
    }
  }

  function subscribe(api, hookName = "") {
    const normalized = String(hookName || "").trim();
    if (!normalized || subscribedHooks.has(normalized)) {
      return;
    }
    subscribedHooks.add(normalized);
    api.addHook(normalized, async (payload = {}) => {
      recordHookEvent(normalized, payload);
      return payload;
    });
  }

  function buildStats() {
    const hooks = [...hookCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name, count]) => ({ name, count }));
    return {
      maxEvents: normalizedMaxEvents,
      storedEvents: events.length,
      droppedCount,
      subscribedHooks: [...subscribedHooks].sort((left, right) => left.localeCompare(right)),
      hooks
    };
  }

  function readEvents(query = {}) {
    const sinceTs = normalizeNumber(query?.sinceTs ?? query?.since_ts ?? 0, 0, 0);
    const limit = normalizeNumber(query?.limit ?? 120, 120, 1, 500);
    const hookFilter = sanitizeHookToken(query?.hook ?? query?.hook_name ?? "");
    const subsystemFilter = sanitizeHookToken(query?.subsystem ?? "");
    const contains = String(query?.contains || "").trim().toLowerCase();
    const filtered = events.filter((entry) => {
      if (sinceTs && Number(entry.at || 0) < sinceTs) {
        return false;
      }
      if (hookFilter && !String(entry.hook || "").toLowerCase().includes(hookFilter)) {
        return false;
      }
      if (subsystemFilter && sanitizeHookToken(entry.subsystem || "") !== subsystemFilter) {
        return false;
      }
      if (contains) {
        const haystack = JSON.stringify(entry).toLowerCase();
        if (!haystack.includes(contains)) {
          return false;
        }
      }
      return true;
    });
    const limited = filtered.slice(Math.max(0, filtered.length - limit));
    return {
      totalCount: filtered.length,
      returnedCount: limited.length,
      events: limited
    };
  }

  function clearEvents() {
    const clearedCount = events.length;
    events.splice(0, events.length);
    hookCounts.clear();
    droppedCount = 0;
    return { clearedCount };
  }

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: false,
        capabilities: ["getHookExplorerStats", "readHookExplorerEvents", "clearHookExplorerEvents"],
        hooks: ["*"],
        runtimeContext: ["promptReviewService", "taskFlightRecorder", "coreTransactions"]
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
      // Hook Explorer — subscribe to hooks
      const hookNames = [
        "http:request-started",
        "http:request-completed",
        "observer:event",
        "permissions:decision",
        "queue:task-dispatch-started",
        "queue:task-processed",
        "queue:batch-started",
        "queue:batch-processed",
        "cron:tick-started",
        "cron:tick-completed",
        "subsystem:intake:triage-started",
        "subsystem:intake:triage-completed",
        "subsystem:intake:triage-failed",
        "subsystem:voice:response-annotated",
        "subsystem:pipeline:collection-build-started",
        "subsystem:pipeline:collection-build-completed",
        "subsystem:pipeline:collection-build-failed",
        "subsystem:projects:pipelines-list-started",
        "subsystem:projects:pipelines-list-completed",
        "subsystem:projects:pipelines-list-failed",
        "subsystem:projects:pipeline-trace-started",
        "subsystem:projects:pipeline-trace-completed",
        "subsystem:projects:pipeline-trace-failed"
      ];
      for (const hookName of hookNames) {
        subscribe(api, hookName);
      }

      // Hook Explorer — UI panel
      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "hook-explorer-panel",
          title: "Hook Explorer",
          description: "Inspect captured hook payloads across all subsystems.",
          fields: [
            {
              id: "limit",
              label: "Limit",
              type: "number",
              min: 1,
              max: 500,
              step: 1,
              defaultValue: 120
            },
            {
              id: "hook",
              label: "Hook Filter",
              type: "text",
              placeholder: "subsystem:projects:request-completed"
            },
            {
              id: "subsystem",
              label: "Subsystem",
              type: "text",
              placeholder: "projects"
            },
            {
              id: "contains",
              label: "Contains Text",
              type: "text",
              placeholder: "/api/projects/"
            },
            {
              id: "since_ts",
              label: "Since Timestamp",
              type: "number",
              min: 0,
              step: 1
            }
          ],
          actions: [
            {
              id: "stats",
              label: "Stats",
              method: "GET",
              endpoint: "/api/plugins/hook-explorer/stats",
              expects: "json"
            },
            {
              id: "events",
              label: "Load Events",
              method: "GET",
              endpoint: "/api/plugins/hook-explorer/events",
              queryFields: ["limit", "hook", "subsystem", "contains", "since_ts"],
              expects: "json"
            },
            {
              id: "clear",
              label: "Clear",
              method: "POST",
              endpoint: "/api/plugins/hook-explorer/clear",
              expects: "json",
              confirm: "Clear captured Hook Explorer events?"
            }
          ]
        });
      }

      // Prompt Review — UI tab
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "prompt-review",
          title: "Prompts",
          icon: "R",
          order: 18,
          scriptUrl: "/api/plugin-ui/prompt-review/tab.js"
        });
      }

      // Flight Recorder — UI tab
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "flight-recorder",
          title: "Flight Recorder",
          icon: "F",
          order: 85,
          scriptUrl: "/api/plugin-ui/flight-recorder/tab.js"
        });
      }

      // State Browser — UI tab
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "state-browser",
          title: "State",
          icon: "S",
          order: 90,
          scriptUrl: "/api/plugin-ui/state-browser/tab.js"
        });
      }

      // Hook Explorer — capabilities
      api.provideCapability("getHookExplorerStats", () => buildStats());
      api.provideCapability("readHookExplorerEvents", (query) => readEvents(query));
      api.provideCapability("clearHookExplorerEvents", () => clearEvents());
    },
    async registerRoutes({ app, api }) {
      // ── Hook Explorer routes ──────────────────────────────────────────────
      app.get("/api/plugins/hook-explorer/stats", async (_req, res) => {
        try {
          const getStats = api.getCapability("getHookExplorerStats");
          if (typeof getStats !== "function") {
            return res.status(500).json({ ok: false, error: "hook explorer stats capability is unavailable" });
          }
          res.json({ ok: true, stats: getStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read hook explorer stats") });
        }
      });

      app.get("/api/plugins/hook-explorer/events", async (req, res) => {
        try {
          const readEventsCapability = api.getCapability("readHookExplorerEvents");
          if (typeof readEventsCapability !== "function") {
            return res.status(500).json({ ok: false, error: "hook explorer read capability is unavailable" });
          }
          const result = readEventsCapability(req.query || {});
          res.json({ ok: true, ...result, stats: buildStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to read hook explorer events") });
        }
      });

      app.post("/api/plugins/hook-explorer/clear", async (_req, res) => {
        try {
          const clearEventsCapability = api.getCapability("clearHookExplorerEvents");
          if (typeof clearEventsCapability !== "function") {
            return res.status(500).json({ ok: false, error: "hook explorer clear capability is unavailable" });
          }
          const result = clearEventsCapability();
          res.json({ ok: true, ...result, stats: buildStats() });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to clear hook explorer events") });
        }
      });

      // ── Prompt Review routes ──────────────────────────────────────────────
      app.get("/api/plugins/developer-tools/task-debug", async (req, res) => {
        try {
          const taskId = String(req.query?.taskId || "").trim();
          const limit = normalizeNumber(req.query?.limit || 80, 80, 5, 500);
          if (!taskId) {
            return res.status(400).json({ ok: false, error: "taskId is required" });
          }
          const runtime = api.getRuntimeContext();
          const flightRecorder = runtime?.taskFlightRecorder && typeof runtime.taskFlightRecorder === "object"
            ? runtime.taskFlightRecorder
            : null;
          if (!flightRecorder || typeof flightRecorder.buildDebugPacket !== "function") {
            return res.status(503).json({ ok: false, error: "task flight recorder is unavailable" });
          }
          const packet = await flightRecorder.buildDebugPacket(taskId, { limit });
          res.json(packet);
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to build task debug packet") });
        }
      });

      app.get("/api/plugin-ui/prompt-review/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "prompt-review-tab.js"));
      });

      app.get("/api/prompts/review", async (_req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const promptReviewService = runtime?.promptReviewService && typeof runtime.promptReviewService === "object"
            ? runtime.promptReviewService
            : null;
          if (!promptReviewService || typeof promptReviewService.generateReview !== "function") {
            return res.status(503).json({ ok: false, error: "prompt-review runtime context is unavailable" });
          }

          const observerConfig = api.getObserverConfig?.() || {};
          const selectedMountIds = Array.isArray(observerConfig?.defaults?.mountIds)
            ? observerConfig.defaults.mountIds.map((value) => String(value))
            : [];
          const internetEnabled = observerConfig?.defaults?.internetEnabled !== false;
          const review = await promptReviewService.generateReview({
            internetEnabled,
            selectedMountIds
          });

          res.json({
            ok: true,
            generatedAt: Number(review?.generatedAt || Date.now()),
            entries: Array.isArray(review?.entries) ? review.entries : []
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "prompt review failed") });
        }
      });

      // ── Flight Recorder routes ────────────────────────────────────────────
      app.get("/api/plugin-ui/flight-recorder/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "flight-recorder-tab.js"));
      });

      // ── State Browser routes ──────────────────────────────────────────────
      app.get("/api/plugin-ui/state-browser/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "state-browser-tab.js"));
      });
    }
  };
}
