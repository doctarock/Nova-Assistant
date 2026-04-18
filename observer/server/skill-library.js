export function sanitizeSkillSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function parseClawhubSearchResults(stdout = "") {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = line.match(/^([a-z0-9._-]+)\s+(.+?)\s+\(([\d.]+)\)$/i);
    if (!match) {
      continue;
    }
    results.push({
      slug: match[1],
      summary: match[2],
      score: Number(match[3]) || 0
    });
  }
  return results;
}

export function ensureClawhubCommandSucceeded(result, action = "clawhub command") {
  if (Number(result?.code) === 0) {
    return result;
  }
  const details = String(result?.stderr || result?.stdout || "").trim();
  throw new Error(details ? `${action} failed: ${details}` : `${action} failed`);
}

export function createSkillLibraryService({
  ensureObserverToolContainer,
  runObserverToolContainerNode,
  readVolumeFile,
  writeVolumeText,
  readContainerFile,
  listContainerFiles,
  observerContainerWorkspaceRoot,
  observerContainerSkillsRoot,
  skillRegistryPath
} = {}) {
  async function runClawhubCommand(args = [], { timeoutMs = 120000 } = {}) {
    await ensureObserverToolContainer();
    return runObserverToolContainerNode(`
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
async function readInput() {
  return JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
}
async function main() {
  const payload = await readInput();
  const skillsRoot = payload.skillsRoot;
  const tmpHome = path.join(payload.workspaceRoot, ".clawhub-home");
  const npmCache = path.join(payload.workspaceRoot, ".clawhub-npm-cache");
  await fs.mkdir(skillsRoot, { recursive: true });
  await fs.mkdir(tmpHome, { recursive: true });
  await fs.mkdir(npmCache, { recursive: true });
  const args = ["--yes", "--cache", npmCache, "clawhub", "--no-input", "--workdir", payload.workspaceRoot, "--dir", "skills", ...(Array.isArray(payload.args) ? payload.args : [])];
  const child = spawn("npx", args, {
    cwd: payload.workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      npm_config_cache: npmCache
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  process.stdout.write(JSON.stringify({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      args,
      workspaceRoot: observerContainerWorkspaceRoot,
      skillsRoot: observerContainerSkillsRoot
    }, { timeoutMs });
  }

  async function loadSkillRegistryState() {
    try {
      const content = await readVolumeFile(skillRegistryPath);
      const parsed = JSON.parse(content);
      return {
        approved: parsed && typeof parsed.approved === "object" && parsed.approved ? parsed.approved : {}
      };
    } catch {
      return { approved: {} };
    }
  }

  async function saveSkillRegistryState(state = null) {
    const nextState = state && typeof state === "object"
      ? state
      : await loadSkillRegistryState();
    await writeVolumeText(skillRegistryPath, `${JSON.stringify(nextState, null, 2)}\n`);
  }

  async function containerSkillExists(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    try {
      const skillPath = `${observerContainerSkillsRoot}/${safeSlug}/SKILL.md`;
      await readContainerFile(skillPath);
      return true;
    } catch {
      return false;
    }
  }

  async function isApprovedInstalledSkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      return false;
    }
    const state = await loadSkillRegistryState();
    return Boolean(state.approved?.[safeSlug]?.approvedAt);
  }

  async function approveInstalledSkill(slug = "", meta = {}) {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    const state = await loadSkillRegistryState();
    state.approved[safeSlug] = {
      approvedAt: Date.now(),
      source: "user-request",
      ...meta
    };
    await saveSkillRegistryState(state);
  }

  async function revokeInstalledSkillApproval(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    const state = await loadSkillRegistryState();
    if (state.approved?.[safeSlug]) {
      delete state.approved[safeSlug];
      await saveSkillRegistryState(state);
    }
  }

  async function searchSkillLibrary(query = "", limit = 6) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      throw new Error("query is required");
    }
    const boundedLimit = Math.max(1, Math.min(12, Number(limit) || 6));
    const result = ensureClawhubCommandSucceeded(
      await runClawhubCommand(["search", trimmed, "--limit", String(boundedLimit)], { timeoutMs: 120000 }),
      "skill library search"
    );
    return {
      query: trimmed,
      results: parseClawhubSearchResults(result.stdout).slice(0, boundedLimit)
    };
  }

  async function inspectSkillLibrarySkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    const result = ensureClawhubCommandSucceeded(
      await runClawhubCommand(["inspect", safeSlug, "--json"], { timeoutMs: 120000 }),
      `skill library inspect for ${safeSlug}`
    );
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error("failed to parse skill inspection result");
    }
    const skill = parsed.skill || {};
    const latestVersion = parsed.latestVersion || {};
    const owner = skill.owner || {};
    return {
      slug: String(skill.slug || safeSlug),
      name: String(skill.displayName || skill.name || safeSlug),
      summary: String(skill.summary || ""),
      description: String(skill.description || skill.summary || ""),
      version: String(latestVersion.version || ""),
      owner: String(owner.handle || owner.name || ""),
      homepage: String(skill.homepage || ""),
      repoUrl: String(skill.repoUrl || ""),
      installed: await containerSkillExists(safeSlug),
      approved: await isApprovedInstalledSkill(safeSlug)
    };
  }

  function parseInstalledSkillMetadata(content = "", safeSlug = "") {
    const text = String(content || "");
    const lines = text.split(/\r?\n/);
    const pickFrontmatter = (field) => {
      const pattern = new RegExp(`^${field}:\\s*(.+)$`, "mi");
      return String(text.match(pattern)?.[1] || "").trim();
    };
    let name = pickFrontmatter("name");
    let description = pickFrontmatter("description") || pickFrontmatter("summary");
    if (!name) {
      const heading = text.match(/^\s*#\s+(.+?)\s*$/m);
      name = String(heading?.[1] || "").trim();
    }
    if (!description) {
      const firstBodyLine = lines
        .map((line) => String(line || "").trim())
        .find((line) =>
          line
          && !line.startsWith("#")
          && !line.startsWith("```")
          && line !== "---"
          && !/^[A-Za-z0-9_.-]+:\s+/.test(line)
        );
      description = String(firstBodyLine || "").trim();
    }
    return {
      name: name || safeSlug,
      description
    };
  }

  async function inspectInstalledSkill(slug = "") {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    const skillPath = `${observerContainerSkillsRoot}/${safeSlug}/SKILL.md`;
    if (!(await containerSkillExists(safeSlug))) {
      throw new Error(`skill ${safeSlug} is not installed`);
    }
    const content = await readContainerFile(skillPath);
    const metadata = parseInstalledSkillMetadata(content, safeSlug);
    return {
      slug: safeSlug,
      name: String(metadata.name || safeSlug).trim(),
      description: String(metadata.description || "").trim(),
      skillPath,
      containerPath: `${observerContainerSkillsRoot}/${safeSlug}/SKILL.md`,
      approved: await isApprovedInstalledSkill(safeSlug)
    };
  }

  async function installSkillIntoWorkspace(slug = "", { approvedByUser = false } = {}) {
    const safeSlug = sanitizeSkillSlug(slug);
    if (!safeSlug) {
      throw new Error("skill slug is required");
    }
    ensureClawhubCommandSucceeded(
      await runClawhubCommand(["install", safeSlug, "--force"], { timeoutMs: 180000 }),
      `skill install for ${safeSlug}`
    );
    if (!(await containerSkillExists(safeSlug))) {
      throw new Error(`skill ${safeSlug} did not appear in the sandbox workspace`);
    }
    if (approvedByUser) {
      await approveInstalledSkill(safeSlug, { installRequestedAt: Date.now() });
    }
    const details = await inspectInstalledSkill(safeSlug);
    return {
      slug: safeSlug,
      installed: true,
      approved: await isApprovedInstalledSkill(safeSlug),
      containerPath: `${observerContainerSkillsRoot}/${safeSlug}`,
      skill: details
    };
  }

  async function listInstalledSkills() {
    await ensureObserverToolContainer();
    const entries = await listContainerFiles(observerContainerSkillsRoot).catch(() => []);
    const skills = [];
    for (const entry of entries) {
      if (entry.type !== "dir") {
        continue;
      }
      const relative = String(entry.path || "").replace(`${observerContainerSkillsRoot}/`, "");
      if (!relative || relative.includes("/")) {
        continue;
      }
      const slug = sanitizeSkillSlug(entry.name || relative);
      if (!slug) {
        continue;
      }
      if (!(await containerSkillExists(slug))) {
        continue;
      }
      try {
        skills.push(await inspectInstalledSkill(slug));
      } catch {
        // skip malformed installed skills
      }
    }
    return skills.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async function buildInstalledSkillsGuidanceNote() {
    const skills = (await listInstalledSkills()).filter((skill) => skill.approved);
    if (!skills.length) {
      return [
        `Installed skills directory: ${observerContainerSkillsRoot}`,
        "No approved extra OpenClaw skills are active right now. Only explicitly user-approved skills should be treated as operational guidance."
      ].join("\n");
    }
    return [
      `Installed skills directory: ${observerContainerSkillsRoot}`,
      "Only these explicitly user-approved OpenClaw skills are active guidance inside the workspace. Read only the relevant skills/<slug>/SKILL.md file when a task calls for it.",
      ...skills.slice(0, 12).map((skill) => `- ${skill.slug}: ${skill.description || skill.name} (${skill.containerPath})`)
    ].join("\n");
  }

  return {
    approveInstalledSkill,
    buildInstalledSkillsGuidanceNote,
    containerSkillExists,
    inspectInstalledSkill,
    inspectSkillLibrarySkill,
    installSkillIntoWorkspace,
    isApprovedInstalledSkill,
    listInstalledSkills,
    loadSkillRegistryState,
    revokeInstalledSkillApproval,
    runClawhubCommand,
    saveSkillRegistryState,
    searchSkillLibrary
  };
}
