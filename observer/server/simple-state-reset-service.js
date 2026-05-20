export function createSimpleStateResetService({
  clearDirectoryContents,
  ensureObserverOutputDir,
  ensureObserverToolContainer,
  fs,
  observerContainerWorkspaceRoot,
  observerInputHostRoot,
  observerOutputHostRoot,
  path,
  runObserverToolContainerNode,
  simpleStateDirectiveFileName,
  simpleStateDirectiveText,
  simpleStateProjectName,
  simpleStateTodayText
} = {}) {
  async function resetSandboxContainerWorkspaceToSimpleProjectState() {
    await ensureObserverToolContainer();
    await runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");

async function removeDateStampedMarkdownFiles(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^\\d{4}-\\d{2}-\\d{2}\\.md$/i.test(entry.name))
      .map((entry) => fs.rm(path.posix.join(dirPath, entry.name), { force: true }))
  );
}

async function clearDirectoryContents(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map((entry) => fs.rm(path.posix.join(dirPath, entry.name), { recursive: true, force: true })));
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
  const promptFilesRoot = path.posix.join(root, "prompt-files");
  const projectsRoot = path.posix.join(root, "projects");
  const memoryRoot = path.posix.join(root, "memory");
  const keepNames = new Set([
    ".clawhub",
    ".clawhub-home",
    ".clawhub-npm-cache",
    "browser-tool.mjs",
    "ollama-direct.mjs",
    "prompt-files",
    "projects",
    "skills",
    "memory"
  ]);

  const rootEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (keepNames.has(entry.name)) continue;
    await fs.rm(path.posix.join(root, entry.name), { recursive: true, force: true });
  }

  await removeDateStampedMarkdownFiles(memoryRoot);
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "briefings"));
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "questions"));
  await removeDateStampedMarkdownFiles(path.posix.join(memoryRoot, "personal"));
  await fs.rm(path.posix.join(memoryRoot, "projects"), { recursive: true, force: true });
  await fs.mkdir(path.posix.join(memoryRoot, "projects"), { recursive: true });
  await fs.mkdir(promptFilesRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });
  await clearDirectoryContents(projectsRoot);
  await fs.writeFile(path.posix.join(promptFilesRoot, "TODAY.md"), String(payload.todayText || ""), "utf8");
  await fs.writeFile(path.posix.join(promptFilesRoot, "MEMORY.md"), String(payload.memoryText || ""), "utf8");

  process.stdout.write(JSON.stringify({
    reset: true,
    projectsRoot
  }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, {
      root: observerContainerWorkspaceRoot,
      todayText: simpleStateTodayText,
      memoryText: "# MEMORY.md\\n\\n- simple-check-project in observer-input\\n"
    }, { timeoutMs: 60000 });
  }

  async function resetToSimpleProjectState() {
    await Promise.all([
      clearDirectoryContents(observerInputHostRoot),
      clearDirectoryContents(observerOutputHostRoot)
    ]);

    await Promise.all([
      fs.mkdir(observerInputHostRoot, { recursive: true }),
      ensureObserverOutputDir()
    ]);

    const projectDir = path.join(observerInputHostRoot, simpleStateProjectName);
    const directivePath = path.join(projectDir, simpleStateDirectiveFileName);
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(directivePath, simpleStateDirectiveText, "utf8");
    await resetSandboxContainerWorkspaceToSimpleProjectState();

    return {
      message: "Accessible state reset complete. Nova now has one simple checkbox project.",
      projectName: simpleStateProjectName,
      directiveFile: `observer-input/${simpleStateProjectName}/${simpleStateDirectiveFileName}`,
      summaryLines: [
        "Reset complete.",
        "Cleared observer-input and observer-output.",
        "Cleared the persistent sandbox workspace projects area without pre-importing any projects.",
        `Seeded observer-input/${simpleStateProjectName}/${simpleStateDirectiveFileName}.`,
        "The sandbox projects list will stay empty until the normal import flow runs.",
        "Directive: Check this box [ ]"
      ]
    };
  }

  return {
    resetSandboxContainerWorkspaceToSimpleProjectState,
    resetToSimpleProjectState
  };
}
