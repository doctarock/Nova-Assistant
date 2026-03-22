const DEFAULT_BASE_URL = "http://127.0.0.1:3220";

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value || 0));
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function printUsage() {
  console.log(`Usage:
  node openclaw-observer/run-regressions.js [suiteId]
  node openclaw-observer/run-regressions.js --suite <suiteId>
  node openclaw-observer/run-regressions.js --list

Options:
  --suite <suiteId>    Run a specific suite. Defaults to "all".
  --list               List the registered regression suites.
  --base-url <url>     Observer API base URL. Defaults to ${DEFAULT_BASE_URL}
  --help               Show this help text.

Environment:
  OBSERVER_BASE_URL    Overrides the default observer API base URL.`);
}

function parseArgs(argv = []) {
  const args = Array.from(argv);
  const options = {
    suiteId: "all",
    listOnly: false,
    baseUrl: String(process.env.OBSERVER_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--list") {
      options.listOnly = true;
      continue;
    }
    if (arg === "--suite") {
      index += 1;
      options.suiteId = String(args[index] || "").trim() || "all";
      continue;
    }
    if (arg === "--base-url") {
      index += 1;
      options.baseUrl = String(args[index] || "").trim() || options.baseUrl;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    options.suiteId = arg;
  }
  return options;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`Observer returned HTTP ${response.status}: ${text || "no response body"}`);
    }
    throw new Error(`Observer returned invalid JSON: ${text || "empty response"}`);
  }
}

async function requestObserverJson(baseUrl, path, init = {}) {
  const targetUrl = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  let response;
  try {
    response = await fetch(targetUrl, init);
  } catch (error) {
    throw new Error(`Could not reach observer at ${baseUrl}: ${error.message}`);
  }
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `Observer returned HTTP ${response.status}`);
  }
  return payload;
}

function printSuiteList(suites = []) {
  if (!Array.isArray(suites) || !suites.length) {
    console.log("No regression suites are registered.");
    return;
  }
  console.log("Registered regression suites:");
  for (const suite of suites) {
    const caseCount = Number(suite?.caseCount || 0);
    const details = [
      `${caseCount} case${caseCount === 1 ? "" : "s"}`,
      suite?.requiresIdleWorkerLane ? "requires idle local worker lane" : ""
    ].filter(Boolean).join(", ");
    console.log(`- ${suite?.id || "unknown"}: ${suite?.label || suite?.id || "Suite"}${details ? ` (${details})` : ""}`);
    if (suite?.description) {
      console.log(`  ${suite.description}`);
    }
  }
}

function printReport(report) {
  if (!report || !Array.isArray(report.suites)) {
    console.log("Regression run finished without a structured report.");
    return;
  }
  const headline = report.passed
    ? `Regression run passed in ${formatDurationMs(report.durationMs)}.`
    : `Regression run failed in ${formatDurationMs(report.durationMs)}.`;
  console.log(headline);
  for (const suite of report.suites) {
    const status = suite?.passed ? "PASS" : (suite?.blocked ? "BLOCKED" : "FAIL");
    const label = suite?.label || suite?.suiteId || "Suite";
    const meta = [formatDurationMs(suite?.durationMs), suite?.summary].filter(Boolean).join(" | ");
    console.log(`- ${status} ${label}${meta ? ` | ${meta}` : ""}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.listOnly) {
    const payload = await requestObserverJson(options.baseUrl, "/api/regressions/list");
    printSuiteList(payload.suites);
    return;
  }
  console.log(`Running regressions via ${options.baseUrl} (${options.suiteId || "all"}).`);
  const payload = await requestObserverJson(options.baseUrl, "/api/regressions/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ suiteId: options.suiteId || "all" })
  });
  printReport(payload.report);
  if (!payload.report?.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Regression command failed: ${error.message}`);
  process.exitCode = 1;
});
