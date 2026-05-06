import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_ROOT = path.join(REPO_ROOT, "server", "plugins");
const FORBIDDEN_PLUGIN_IMPORTS = [
  "observer-task-storage",
  "observer-task-storage-io",
  "workspace-transaction-service",
  "task-flight-recorder-service"
];

async function listJavaScriptFiles(root) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(full);
        continue;
      }
      if (entry.isFile() && /\.m?js$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

test("plugins do not import core task or transaction internals directly", async () => {
  const files = await listJavaScriptFiles(PLUGINS_ROOT);
  const violations = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    for (const forbidden of FORBIDDEN_PLUGIN_IMPORTS) {
      const importPattern = new RegExp(`from\\s+["'][^"']*${forbidden}\\.js["']|import\\(["'][^"']*${forbidden}\\.js["']\\)`);
      if (importPattern.test(content)) {
        violations.push(`${path.relative(REPO_ROOT, file).replace(/\\/g, "/")} imports ${forbidden}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("workspace-transaction-composition does not import from plugins or server entry", async () => {
  const compositionPath = path.join(REPO_ROOT, "server", "workspace-transaction-composition.js");
  const content = await fs.readFile(compositionPath, "utf8");
  const forbidden = ["/plugins/", "server.js", "observer-queue-processor", "observer-execution-runner"];
  const violations = forbidden.filter((f) => content.includes(f));
  assert.deepEqual(violations, [], `workspace-transaction-composition.js imports: ${violations.join(", ")}`);
});
