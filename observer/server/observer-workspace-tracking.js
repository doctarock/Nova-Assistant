export function createObserverWorkspaceTracking(context = {}) {
  const {
    OBSERVER_CONTAINER_WORKSPACE_ROOT,
    OBSERVER_OUTPUT_ROOT,
    fs,
    isPathWithinAllowedRoots,
    normalizeContainerMountPathCandidate,
    normalizeContainerPathForComparison,
    path,
    resolveSourcePathFromContainerPath,
    runObserverToolContainerNode
  } = context;

  function resolveObserverOutputPath(relativePath = "") {
    const normalized = path.normalize(relativePath || "");
    const target = normalized === "." ? OBSERVER_OUTPUT_ROOT : path.resolve(OBSERVER_OUTPUT_ROOT, normalized);
    if (!target.startsWith(OBSERVER_OUTPUT_ROOT)) {
      throw new Error("path escapes observer output");
    }
    return target;
  }

  function extractContainerPathCandidates(text = "") {
    const candidates = new Set();
    for (const line of String(text || "").split(/\r?\n/)) {
      const matches = line.match(/\/home\/openclaw\/[^\r\n]*/g) || [];
      for (const match of matches) {
        const trimmedMatch = match.replace(/[)"'`,;:!?]+$/g, "").trim();
        const normalized = normalizeContainerMountPathCandidate(trimmedMatch)
          || normalizeContainerMountPathCandidate(trimmedMatch.replace(/\.+$/g, ""));
        if (normalized) {
          candidates.add(normalized);
        }
      }
    }
    return [...candidates];
  }

  function isContainerWorkspacePath(targetPath = "") {
    const normalized = normalizeContainerPathForComparison(targetPath);
    return normalized === OBSERVER_CONTAINER_WORKSPACE_ROOT
      || normalized.startsWith(`${OBSERVER_CONTAINER_WORKSPACE_ROOT}/`);
  }

  function collectTrackedWorkspaceTargets(text = "") {
    const hostPaths = new Set();
    const containerWorkspacePaths = new Set();
    for (const candidate of extractContainerPathCandidates(text)) {
      if (isContainerWorkspacePath(candidate)) {
        containerWorkspacePaths.add(normalizeContainerPathForComparison(candidate));
        continue;
      }
      const resolved = resolveSourcePathFromContainerPath(candidate);
      if (resolved) {
        hostPaths.add(path.resolve(resolved));
      }
    }
    return {
      hostPaths: [...hostPaths],
      containerWorkspacePaths: [...containerWorkspacePaths]
    };
  }

  async function listTrackedWorkspaceFiles(pathsToTrack = []) {
    const files = [];
    const seen = new Set();
    const containerWorkspaceTargets = [];
    const hostTargets = [];
    const skippedDirectories = new Set([".git", "node_modules", ".next", "dist", "build", ".cache"]);
    for (const candidate of Array.isArray(pathsToTrack) ? pathsToTrack : []) {
      if (!candidate) {
        continue;
      }
      if (isContainerWorkspacePath(candidate)) {
        containerWorkspaceTargets.push(normalizeContainerPathForComparison(candidate));
        continue;
      }
      hostTargets.push(candidate);
    }
    async function walk(targetPath) {
      let stats;
      try {
        stats = await fs.stat(targetPath);
      } catch {
        return;
      }
      const resolved = path.resolve(targetPath);
      if (seen.has(resolved)) {
        return;
      }
      seen.add(resolved);
      if (stats.isFile()) {
        files.push({
          fullPath: resolved,
          size: Number(stats.size || 0),
          modifiedAt: Number(stats.mtimeMs || 0)
        });
        return;
      }
      if (!stats.isDirectory()) {
        return;
      }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
          continue;
        }
        await walk(path.join(resolved, entry.name));
      }
    }
    for (const candidate of hostTargets) {
      if (!candidate || !isPathWithinAllowedRoots(candidate)) {
        continue;
      }
      await walk(candidate);
    }
    if (containerWorkspaceTargets.length) {
      const snapshot = await runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");

async function readPayload() {
  return JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
}

async function main() {
  const payload = await readPayload();
  const files = [];
  const seen = new Set();
  const skippedDirectories = new Set([".git", "node_modules", ".next", "dist", "build", ".cache"]);

  async function walk(targetPath) {
    let stats;
    try {
      stats = await fs.stat(targetPath);
    } catch {
      return;
    }
    const normalizedPath = String(targetPath || "").replace(/\\\\/g, "/");
    if (seen.has(normalizedPath)) {
      return;
    }
    seen.add(normalizedPath);
    if (stats.isFile()) {
      files.push({
        fullPath: normalizedPath,
        containerPath: normalizedPath,
        size: Number(stats.size || 0),
        modifiedAt: Number(stats.mtimeMs || 0)
      });
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    let entries = [];
    try {
      entries = await fs.readdir(targetPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
        continue;
      }
      await walk(path.posix.join(normalizedPath, entry.name));
    }
  }

  for (const candidate of Array.isArray(payload.pathsToTrack) ? payload.pathsToTrack : []) {
    if (!candidate) {
      continue;
    }
    await walk(String(candidate));
  }
  files.sort((left, right) => String(left.fullPath || "").localeCompare(String(right.fullPath || "")));
  process.stdout.write(JSON.stringify({ files }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
        pathsToTrack: [...new Set(containerWorkspaceTargets)]
      }, { timeoutMs: 60000 });
      if (Array.isArray(snapshot?.files)) {
        files.push(...snapshot.files);
      }
    }
    files.sort((left, right) => left.fullPath.localeCompare(right.fullPath));
    return files;
  }

  return {
    collectTrackedWorkspaceTargets,
    extractContainerPathCandidates,
    isContainerWorkspacePath,
    listTrackedWorkspaceFiles,
    resolveObserverOutputPath
  };
}
