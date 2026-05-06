export function createSandboxWorkspaceService({
  ensureObserverToolContainer,
  observerContainerInputRoot,
  observerContainerOutputRoot,
  observerContainerProjectsRoot,
  runObserverToolContainerNode,
  runCommand,
  observerToolContainer,
  observerContainerWorkspaceRoot,
  quoteShellPath
} = {}) {
  const WORKSPACE_PROJECT_MARKER_FILE = ".observer-project.json";
  const workspaceProjectsRoot = String(observerContainerProjectsRoot || `${observerContainerWorkspaceRoot}/projects`).trim();
  const GENERIC_WORKSPACE_PROJECT_NAMES = [
    "app",
    "apps",
    "assets",
    "build",
    "coverage",
    "dist",
    "docs",
    "lib",
    "logs",
    "node_modules",
    "output",
    "outputs",
    "packages",
    "public",
    "scripts",
    "src",
    "test",
    "tests",
    "tmp",
    "temp"
  ];

  async function archiveWorkspaceProjectsToOutput(projects = [], { archiveRoot = "", timeoutMs = 120000 } = {}) {
    const normalizedProjects = Array.isArray(projects)
      ? projects
        .map((entry) => ({
          name: String(entry?.targetName || entry?.name || "").trim(),
          path: String(entry?.path || "").trim()
        }))
        .filter((entry) => entry.name && entry.path)
      : [];
    if (!normalizedProjects.length) {
      return [];
    }
    const effectiveArchiveRoot = String(archiveRoot || "").trim()
      || `${observerContainerOutputRoot}/workspace-archive/${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await ensureObserverToolContainer();
    const commands = [`mkdir -p ${quoteShellPath(effectiveArchiveRoot)}`];
    const archived = [];
    for (const project of normalizedProjects) {
      const targetPath = `${effectiveArchiveRoot}/${project.name}`;
      commands.push(`mv ${quoteShellPath(project.path)} ${quoteShellPath(targetPath)}`);
      archived.push({ name: project.name, targetPath });
    }
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      commands.join(" && ")
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 120000), 300000))
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to archive workspace projects");
    }
    return archived;
  }

  async function listContainerWorkspaceProjects() {
    const result = await runObserverToolContainerNode(`
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

function looksMalformedProjectName(name) {
  const text = String(name || "").trim();
  if (!text) {
    return true;
  }
  if (!/[a-z0-9]/i.test(text)) {
    return true;
  }
  if (/["'\`]/.test(text)) {
    return true;
  }
  if (/^task-\d{10,}$/i.test(text)) {
    return true;
  }
  return false;
}

function isGenericProjectName(name, genericNames) {
  const lower = String(name || "").trim().toLowerCase();
  return genericNames.includes(lower);
}

function parseMarkerJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function inspectProjectCandidate(fullPath, entryName, markerFileName, genericNames) {
  const entries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
  const visibleEntries = entries.filter((entry) => !String(entry.name || "").startsWith("."));
  const lowerNames = new Set(visibleEntries.map((entry) => String(entry.name || "").trim().toLowerCase()));
  const markerPath = path.posix.join(fullPath, markerFileName);
  const hasMarker = await pathExists(markerPath);
  let marker = null;
  if (hasMarker) {
    marker = parseMarkerJson(await fs.readFile(markerPath, "utf8").catch(() => ""));
  }
  const hasDirective = lowerNames.has("directive.md");
  const hasPlanning = lowerNames.has("project-todo.md") || lowerNames.has("project-role-tasks.md");
  const hasReadme = lowerNames.has("readme.md");
  const hasPackageJson = lowerNames.has("package.json");
  const hasImplementationDir = visibleEntries.some((entry) =>
    entry.isDirectory() && /^(src|app|lib|server|api|assets|includes|observer-input|manuscript|chapters?)$/i.test(String(entry.name || "").trim())
  );
  const hasImplementationFile = visibleEntries.some((entry) =>
    entry.isFile() && /\.(js|jsx|ts|tsx|mjs|cjs|php|py|java|go|rs|c|cpp|cs|html|css|scss|sass|md|txt|json|ya?ml)$/i.test(String(entry.name || "").trim())
  );
  const significantEntries = visibleEntries.filter((entry) =>
    !/^(project-todo\.md|project-role-tasks\.md|readme\.md|package\.json)$/i.test(String(entry.name || "").trim())
  );
  return {
    hasMarker,
    marker,
    genericName: isGenericProjectName(entryName, Array.isArray(genericNames) ? genericNames : []),
    hasDirective,
    hasPlanning,
    hasReadme,
    hasPackageJson,
    hasImplementationDir,
    hasImplementationFile,
    hasSignificantEntries: significantEntries.length > 0
  };
}

async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const root = payload.root;
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (looksMalformedProjectName(entry.name)) continue;
    const fullPath = path.posix.join(root, entry.name);
    const candidate = await inspectProjectCandidate(
      fullPath,
      entry.name,
      String(payload.markerFileName || ".observer-project.json"),
      payload.genericNames
    );
    if (!candidate.hasMarker) {
      if (candidate.genericName) continue;
      if (!candidate.hasDirective && !candidate.hasPlanning && !candidate.hasReadme && !candidate.hasPackageJson && !candidate.hasImplementationDir && !candidate.hasImplementationFile && !candidate.hasSignificantEntries) {
        continue;
      }
    }
    const stat = await fs.stat(fullPath);
    projects.push({
      name: entry.name,
      path: fullPath,
      modifiedAt: Number(stat.mtimeMs || 0),
      explicitMarker: candidate.hasMarker,
      sourceName: String(candidate.marker?.sourceName || "").trim(),
      importedAt: Number(candidate.marker?.importedAt || 0) || null
    });
  }
  process.stdout.write(JSON.stringify({ projects }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      root: workspaceProjectsRoot,
      markerFileName: WORKSPACE_PROJECT_MARKER_FILE,
      genericNames: GENERIC_WORKSPACE_PROJECT_NAMES
    }, { timeoutMs: 30000 });
    return Array.isArray(result.projects) ? result.projects : [];
  }

  async function listFilesInContainer(target, { recursive = false, limit = 200 } = {}) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const output = [];
  async function walk(currentPath, depth = 0) {
    if (output.length >= payload.limit) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.posix.join(currentPath, entry.name);
      output.push({ path: fullPath, type: entry.isDirectory() ? "dir" : "file" });
      if (payload.recursive && entry.isDirectory() && depth < 4 && output.length < payload.limit) {
        await walk(fullPath, depth + 1);
      }
      if (output.length >= payload.limit) break;
    }
  }
  await walk(payload.target);
  process.stdout.write(JSON.stringify({ root: payload.target, entries: output }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      target,
      recursive: Boolean(recursive),
      limit: Math.max(1, Math.min(Number(limit || 200), 500))
    }, { timeoutMs: 60000 });
  }

  async function writeContainerTextFile(target, content, { append = false, timeoutMs = 30000 } = {}) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  await fs.mkdir(path.posix.dirname(payload.target), { recursive: true });
  if (payload.append) {
    await fs.appendFile(payload.target, payload.content, "utf8");
  } else {
    await fs.writeFile(payload.target, payload.content, "utf8");
  }
  process.stdout.write(JSON.stringify({
    path: payload.target,
    bytes: Buffer.byteLength(payload.content, "utf8"),
    append: Boolean(payload.append)
  }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      target,
      content: String(content || ""),
      append: Boolean(append)
    }, { timeoutMs });
  }

  async function editContainerTextFile(
    target,
    {
      edits = [],
      oldText = "",
      newText = "",
      replaceAll = false,
      expectedReplacements = null,
      timeoutMs = 30000
    } = {}
  ) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");

function normalizeEdits(payload) {
  if (Array.isArray(payload.edits) && payload.edits.length) {
    return payload.edits;
  }
  return [{
    oldText: payload.oldText,
    newText: payload.newText,
    replaceAll: payload.replaceAll,
    expectedReplacements: payload.expectedReplacements
  }];
}

function countOccurrences(content, needle) {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length || 1;
  }
  return count;
}

async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const normalizedEdits = normalizeEdits(payload).map((entry) => ({
    oldText: String(entry && Object.prototype.hasOwnProperty.call(entry, "oldText") ? entry.oldText : ""),
    newText: String(entry && Object.prototype.hasOwnProperty.call(entry, "newText") ? entry.newText : ""),
    replaceAll: Boolean(entry && entry.replaceAll),
    expectedReplacements: entry && entry.expectedReplacements != null ? Number(entry.expectedReplacements) : null
  }));
  if (!normalizedEdits.length) {
    throw new Error("at least one edit is required");
  }
  let content = await fs.readFile(payload.target, "utf8");
  let totalReplacements = 0;
  const applied = [];
  for (const entry of normalizedEdits) {
    if (!entry.oldText) {
      throw new Error("edit oldText is required");
    }
    const replacementCount = entry.replaceAll
      ? countOccurrences(content, entry.oldText)
      : (content.includes(entry.oldText) ? 1 : 0);
    if (replacementCount < 1) {
      const alreadyAppliedCount = entry.newText
        ? (entry.replaceAll ? countOccurrences(content, entry.newText) : (content.includes(entry.newText) ? 1 : 0))
        : 0;
      const expectedAlreadyApplied = entry.expectedReplacements != null
        ? alreadyAppliedCount === entry.expectedReplacements
        : alreadyAppliedCount > 0;
      if (expectedAlreadyApplied) {
        applied.push({
          oldText: entry.oldText,
          newText: entry.newText,
          replaceAll: entry.replaceAll,
          replacements: 0,
          alreadyApplied: true
        });
        continue;
      }
      throw new Error(\`oldText not found in \${payload.target}\`);
    }
    if (entry.expectedReplacements != null && replacementCount !== entry.expectedReplacements) {
      throw new Error(\`expected \${entry.expectedReplacements} replacement(s) but found \${replacementCount}\`);
    }
    content = entry.replaceAll
      ? content.split(entry.oldText).join(entry.newText)
      : content.replace(entry.oldText, entry.newText);
    totalReplacements += replacementCount;
    applied.push({
      oldText: entry.oldText,
      newText: entry.newText,
      replaceAll: entry.replaceAll,
      replacements: replacementCount
    });
  }
  await fs.mkdir(path.posix.dirname(payload.target), { recursive: true });
  await fs.writeFile(payload.target, content, "utf8");
  process.stdout.write(JSON.stringify({
    path: payload.target,
    bytes: Buffer.byteLength(content, "utf8"),
    replacements: totalReplacements,
    editCount: applied.length,
    edits: applied
  }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      target,
      edits,
      oldText,
      newText,
      replaceAll: Boolean(replaceAll),
      expectedReplacements
    }, { timeoutMs });
  }

  async function moveContainerPath(from, to, { overwrite = false, timeoutMs = 30000 } = {}) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  await fs.mkdir(path.posix.dirname(payload.to), { recursive: true });
  if (payload.overwrite) {
    await fs.rm(payload.to, { recursive: true, force: true });
  }
  await fs.rename(payload.from, payload.to);
  process.stdout.write(JSON.stringify({
    from: payload.from,
    to: payload.to,
    overwrite: Boolean(payload.overwrite)
  }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      from,
      to,
      overwrite: Boolean(overwrite)
    }, { timeoutMs });
  }

  async function runSandboxShell(command, { timeoutMs = 60000 } = {}) {
    const normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) {
      throw new Error("command is required");
    }
    await ensureObserverToolContainer();
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      `cd ${quoteShellPath(observerContainerWorkspaceRoot)} && ${normalizedCommand}`
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 60000), 180000))
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut
    };
  }

  async function inspectWorkspaceProject(project) {
    if (!project?.name || !project?.path) {
      return null;
    }
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
async function walk(root, depth, files, summary) {
  if (depth > 3 || files.length >= 120) {
    return;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= 120) break;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
    const full = path.posix.join(root, entry.name);
    if (entry.isDirectory()) {
      summary.directories.push(path.posix.relative(summary.projectPath, full));
      await walk(full, depth + 1, files, summary);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.posix.relative(summary.projectPath, full);
    files.push(rel);
    const lower = rel.toLowerCase();
    if (/(^|\\/)readme\\.md$/.test(lower)) summary.hasReadme = true;
    if (/(^|\\/)package\\.json$/.test(lower)) summary.hasPackageJson = true;
    if (/(^|\\/)project-todo\\.md$/.test(lower)) summary.hasTodo = true;
    if (/(^|\\/)(src|app|lib)\\//.test(lower)) summary.hasSource = true;
    if (/(^|\\/)(test|tests|__tests__)\\//.test(lower) || /\\.test\\./.test(lower) || /\\.spec\\./.test(lower)) summary.hasTests = true;
    if (/todo|fixme/i.test(lower)) summary.hasTodoMarkers = true;
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
  const summary = {
    projectPath: payload.projectPath,
    projectName: payload.projectName,
    hasReadme: false,
    hasPackageJson: false,
    hasTodo: false,
    hasSource: false,
    hasTests: false,
    hasTodoMarkers: false,
    directories: []
  };
  const files = [];
  await walk(payload.projectPath, 0, files, summary);
  process.stdout.write(JSON.stringify({
    ...summary,
    directories: summary.directories.slice(0, 20),
    files
  }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, { projectPath: project.path, projectName: project.name }, { timeoutMs: 60000 });
  }

  async function importRepositoryProjectToWorkspace(project, { timeoutMs = 120000 } = {}) {
    const sourceName = String(project?.sourceName || "").trim();
    const targetName = String(project?.targetName || "").trim();
    if (!sourceName || !targetName) {
      return null;
    }
    const containerSource = `${observerContainerInputRoot}/${sourceName}`;
    const destination = `${workspaceProjectsRoot}/${targetName}`;
    await ensureObserverToolContainer();
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      [
        `mkdir -p ${quoteShellPath(observerContainerInputRoot)}`,
        `test -d ${quoteShellPath(containerSource)}`,
        `rm -rf ${quoteShellPath(destination)}`,
        `mkdir -p ${quoteShellPath(workspaceProjectsRoot)}`,
        `mv ${quoteShellPath(containerSource)} ${quoteShellPath(destination)}`
      ].join(" && ")
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 120000), 300000))
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to import repository project");
    }
    const importedAt = Date.now();
    await runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const markerPath = path.posix.join(payload.projectPath, payload.markerFileName);
  const marker = {
    version: 1,
    projectName: payload.projectName,
    sourceName: payload.sourceName,
    importedAt: Number(payload.importedAt || Date.now())
  };
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify({ markerPath }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      projectPath: destination,
      markerFileName: WORKSPACE_PROJECT_MARKER_FILE,
      projectName: targetName,
      sourceName,
      importedAt
    }, { timeoutMs: 30000 });
    return {
      projectName: targetName,
      sourceName,
      destination,
      modifiedAt: importedAt
    };
  }

  async function snapshotWorkspaceProjectToOutput(project, { targetName = "", targetRoot = "", timeoutMs = 120000 } = {}) {
    const sourcePath = String(project?.path || project?.destination || "").trim();
    const effectiveTargetName = String(targetName || project?.targetName || project?.name || project?.projectName || "").trim();
    const effectiveTargetRoot = String(targetRoot || "").trim();
    if (!sourcePath || !effectiveTargetName || !effectiveTargetRoot) {
      return null;
    }
    await ensureObserverToolContainer();
    const targetPath = `${effectiveTargetRoot}/${effectiveTargetName}`;
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      [
        `mkdir -p ${quoteShellPath(effectiveTargetRoot)}`,
        `rm -rf ${quoteShellPath(targetPath)}`,
        `mkdir -p ${quoteShellPath(targetPath)}`,
        `cp -R ${quoteShellPath(`${sourcePath}/.`)} ${quoteShellPath(targetPath)}`
      ].join(" && ")
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 120000), 300000))
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to snapshot workspace project");
    }
    return {
      name: effectiveTargetName,
      targetPath
    };
  }

  async function moveWorkspaceProjectToOutput(project, { targetName = "", targetRoot = "", timeoutMs = 120000 } = {}) {
    const sourcePath = String(project?.path || "").trim();
    const effectiveTargetName = String(targetName || project?.targetName || project?.name || "").trim();
    const effectiveTargetRoot = String(targetRoot || "").trim();
    if (!sourcePath || !effectiveTargetName || !effectiveTargetRoot) {
      return null;
    }
    await ensureObserverToolContainer();
    const targetPath = `${effectiveTargetRoot}/${effectiveTargetName}`;
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      [
        `mkdir -p ${quoteShellPath(effectiveTargetRoot)}`,
        `mv ${quoteShellPath(sourcePath)} ${quoteShellPath(targetPath)}`
      ].join(" && ")
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 120000), 300000))
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to move workspace project");
    }
    return {
      name: effectiveTargetName,
      targetPath
    };
  }

  async function syncWorkspaceProjectToRepositorySource(project, { sourceName = "", timeoutMs = 120000 } = {}) {
    const sourcePath = String(project?.path || "").trim();
    const effectiveSourceName = String(sourceName || project?.sourceName || "").trim();
    if (!sourcePath || !effectiveSourceName) {
      return null;
    }
    await ensureObserverToolContainer();
    const targetPath = `${observerContainerInputRoot}/${effectiveSourceName}`;
    const result = await runCommand("docker", [
      "exec",
      observerToolContainer,
      "sh",
      "-lc",
      [
        `mkdir -p ${quoteShellPath(observerContainerInputRoot)}`,
        `rm -rf ${quoteShellPath(targetPath)}`,
        `mkdir -p ${quoteShellPath(targetPath)}`,
        `cp -R ${quoteShellPath(`${sourcePath}/.`)} ${quoteShellPath(targetPath)}`
      ].join(" && ")
    ], {
      timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || 120000), 300000))
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed to sync workspace project back to observer-input");
    }
    return {
      sourceName: effectiveSourceName,
      targetPath
    };
  }

  return {
    archiveWorkspaceProjectsToOutput,
    editContainerTextFile,
    inspectWorkspaceProject,
    importRepositoryProjectToWorkspace,
    listContainerWorkspaceProjects,
    listFilesInContainer,
    moveContainerPath,
    snapshotWorkspaceProjectToOutput,
    moveWorkspaceProjectToOutput,
    runSandboxShell,
    syncWorkspaceProjectToRepositorySource,
    writeContainerTextFile
  };
}
