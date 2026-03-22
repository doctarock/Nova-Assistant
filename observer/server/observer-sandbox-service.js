import path from "path";

export function createObserverSandboxService({
  fs,
  runCommand,
  ensurePromptWorkspaceScaffolding,
  ensureInputHostRoot,
  ensureOutputHostRoot,
  observerToolContainer,
  observerToolImage,
  observerToolStateVolume,
  observerInputHostRoot,
  observerOutputHostRoot,
  promptWorkspaceRoot,
  observerToolRuntimeUser,
  observerContainerStateRoot,
  observerContainerWorkspaceRoot,
  observerContainerInputRoot,
  observerContainerOutputRoot,
  observerContainerSkillsRoot
} = {}) {
  const runtimeUser = String(observerToolRuntimeUser || "").trim() || "openclaw";

  function normalizeDockerComparePath(value = "") {
    return path.resolve(String(value || "")).replaceAll("\\", "/").toLowerCase();
  }

  function buildExpectedObserverToolMounts() {
    return [
      {
        type: "volume",
        name: observerToolStateVolume,
        destination: observerContainerStateRoot,
        rw: true
      },
      {
        type: "bind",
        source: observerInputHostRoot,
        destination: observerContainerInputRoot,
        rw: true
      },
      {
        type: "bind",
        source: observerOutputHostRoot,
        destination: observerContainerOutputRoot,
        rw: true
      }
    ];
  }

  async function inspectObserverToolContainerDetails() {
    const result = await runCommand("docker", ["inspect", observerToolContainer], { timeoutMs: 10000 });
    if (result.code !== 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(result.stdout || "[]");
      return parsed[0] || null;
    } catch {
      return null;
    }
  }

  function observerToolContainerMatches(details) {
    if (!details) {
      return false;
    }
    if (String(details?.Config?.Image || "").trim() !== observerToolImage) {
      return false;
    }
    if (String(details?.Config?.WorkingDir || "").trim() !== observerContainerWorkspaceRoot) {
      return false;
    }
    if (String(details?.Config?.User || "").trim() !== runtimeUser) {
      return false;
    }
    const mounts = Array.isArray(details?.Mounts) ? details.Mounts : [];
    const expectedMounts = buildExpectedObserverToolMounts();
    for (const expected of expectedMounts) {
      const match = mounts.find((mount) => {
        if (String(mount?.Type || "").trim() !== expected.type) {
          return false;
        }
        if (String(mount?.Destination || "").trim() !== expected.destination) {
          return false;
        }
        if (Boolean(mount?.RW) !== Boolean(expected.rw)) {
          return false;
        }
        if (expected.type === "volume") {
          return String(mount?.Name || "").trim() === expected.name;
        }
        return true;
      });
      if (!match) {
        return false;
      }
    }
    return !mounts.some((mount) => String(mount?.Destination || "").trim() === "/workspace-dev");
  }

  async function buildPromptSeedSnapshot(rootPath, relativePath = "", depth = 0) {
    if (depth > 8) {
      return [];
    }
    const targetPath = relativePath ? path.join(rootPath, relativePath) : rootPath;
    const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch(() => []);
    const snapshot = [];
    const rootPromptDuplicateNames = new Set(["AGENTS.md", "USER.md", "MEMORY.md", "PERSONAL.md", "MAIL-RULES.md", "SOUL.md", "TODAY.md", "TOOLS.md"]);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relativePath && rootPromptDuplicateNames.has(String(entry.name || "").trim())) {
        continue;
      }
      const nextRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        snapshot.push({
          type: "dir",
          path: nextRelativePath.replaceAll("\\", "/")
        });
        snapshot.push(...await buildPromptSeedSnapshot(rootPath, nextRelativePath, depth + 1));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fullPath = path.join(rootPath, nextRelativePath);
      const content = await fs.readFile(fullPath, "utf8").catch(() => "");
      snapshot.push({
        type: "file",
        path: nextRelativePath.replaceAll("\\", "/"),
        content
      });
    }
    return snapshot;
  }

  async function seedObserverToolWorkspace() {
    const seedEntries = await buildPromptSeedSnapshot(promptWorkspaceRoot);
    const result = await runCommand("docker", [
      "exec",
      "-i",
      observerToolContainer,
      "node",
      "-e",
      `
const fs = require("fs/promises");
const path = require("path");
async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const root = String(payload.root || "").trim();
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  await fs.mkdir(root, { recursive: true });
  for (const fileName of ["AGENTS.md", "USER.md", "MEMORY.md", "PERSONAL.md", "MAIL-RULES.md", "SOUL.md", "TODAY.md", "TOOLS.md"]) {
    await fs.rm(path.posix.join(root, fileName), { force: true });
  }
  for (const entry of entries) {
    const rel = String(entry && entry.path || "").trim();
    if (!rel) continue;
    const target = path.posix.join(root, rel);
    if (entry.type === "dir") {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.posix.dirname(target), { recursive: true });
    if (await pathExists(target)) {
      continue;
    }
    await fs.writeFile(target, String(entry.content || ""), "utf8");
  }
  await fs.mkdir(path.posix.join(root, "projects"), { recursive: true });
  await fs.mkdir(path.posix.join(root, "memory"), { recursive: true });
  await fs.mkdir(path.posix.join(root, "memory", "questions"), { recursive: true });
  await fs.mkdir(path.posix.join(root, "memory", "personal"), { recursive: true });
  await fs.mkdir(String(payload.skillsRoot || ""), { recursive: true });
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`
    ], {
      input: JSON.stringify({
        root: observerContainerWorkspaceRoot,
        skillsRoot: observerContainerSkillsRoot,
        entries: seedEntries
      }),
      timeoutMs: 30000
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to seed observer sandbox workspace");
    }
  }

  function buildObserverToolStateBootstrapScript() {
    return [
      `mkdir -p '${observerContainerStateRoot}'`,
      `mkdir -p '${observerContainerWorkspaceRoot}'`,
      `mkdir -p '${observerContainerWorkspaceRoot}/projects'`,
      `mkdir -p '${observerContainerWorkspaceRoot}/memory'`,
      `mkdir -p '${observerContainerWorkspaceRoot}/memory/questions'`,
      `mkdir -p '${observerContainerWorkspaceRoot}/memory/personal'`,
      `mkdir -p '${observerContainerWorkspaceRoot}/memory/briefings'`,
      `mkdir -p '${observerContainerSkillsRoot}'`,
      `chown -R ${runtimeUser}:${runtimeUser} '${observerContainerStateRoot}'`
    ].join(" && ");
  }

  async function bootstrapObserverToolStateVolume() {
    const result = await runCommand("docker", [
      "run",
      "--rm",
      "--user",
      "0",
      "-v",
      `${observerToolStateVolume}:${observerContainerStateRoot}`,
      observerToolImage,
      "sh",
      "-lc",
      buildObserverToolStateBootstrapScript()
    ], { timeoutMs: 30000 });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to prepare observer sandbox state volume");
    }
  }

  async function ensureObserverToolContainer() {
    await ensureInputHostRoot();
    await ensureOutputHostRoot();
    await ensurePromptWorkspaceScaffolding();
    await bootstrapObserverToolStateVolume();

    const details = await inspectObserverToolContainerDetails();
    if (details && observerToolContainerMatches(details)) {
      if (details?.State?.Running) {
        await seedObserverToolWorkspace();
        return;
      }
      const started = await runCommand("docker", ["start", observerToolContainer], { timeoutMs: 15000 });
      if (started.code === 0) {
        await seedObserverToolWorkspace();
        return;
      }
    }
    if (details) {
      await runCommand("docker", ["rm", "-f", observerToolContainer], { timeoutMs: 15000 });
    }
    const dockerArgs = [
      "run",
      "-d",
      "--name",
      observerToolContainer,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "200",
      "--memory",
      "2g",
      "--cpus",
      "2.0",
      "--user",
      runtimeUser,
      "--tmpfs",
      "/tmp",
      "-w",
      observerContainerWorkspaceRoot,
      "-v",
      `${observerToolStateVolume}:${observerContainerStateRoot}`,
      "-v",
      `${observerInputHostRoot}:${observerContainerInputRoot}`,
      "-v",
      `${observerOutputHostRoot}:${observerContainerOutputRoot}`
    ];
    dockerArgs.push(
      observerToolImage,
      "sh",
      "-lc",
      `mkdir -p '${observerContainerWorkspaceRoot}' && sleep infinity`
    );
    const created = await runCommand("docker", dockerArgs, { timeoutMs: 30000 });
    if (created.code !== 0) {
      throw new Error(created.stderr || "failed to start observer sandbox container");
    }
    await seedObserverToolWorkspace();
  }

  async function runObserverToolContainerNode(script, payload = {}, { timeoutMs = 60000 } = {}) {
    await ensureObserverToolContainer();
    const result = await runCommand("docker", [
      "exec",
      "-i",
      observerToolContainer,
      "node",
      "-e",
      script
    ], {
      input: JSON.stringify(payload || {}),
      timeoutMs
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || `container command failed with exit code ${result.code}`);
    }
    try {
      return JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error("failed to parse container tool response");
    }
  }

  return {
    ensureObserverToolContainer,
    normalizeDockerComparePath,
    runObserverToolContainerNode
  };
}
