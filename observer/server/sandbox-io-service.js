export function createSandboxIoService({
  runCommand,
  runObserverToolContainerNode
} = {}) {
  function stripAnsi(value) {
    return String(value || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").trim();
  }

  function quoteShellPath(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }

  function quotePowerShellString(value) {
    return `'${String(value || "").replace(/'/g, "''")}'`;
  }

  async function runGatewayShell(command, { input } = {}) {
    return runCommand("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      command
    ], { input });
  }

  async function listContainerFiles(rootPath) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
const path = require("path");
function shouldHideInspectorEntry(entryName) {
  if (!entryName) {
    return false;
  }
  return [
    ".git",
    ".gitignore",
    ".gitattributes",
    ".gitmodules"
  ].includes(entryName);
}
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const entries = [];
  async function walk(currentPath, depth = 0) {
    const stat = await fs.stat(currentPath);
    const entryName = path.posix.basename(currentPath);
    if (depth > 0 && shouldHideInspectorEntry(entryName)) {
      return;
    }
    entries.push({
      type: stat.isDirectory() ? "dir" : "file",
      path: currentPath,
      name: entryName
    });
    if (!stat.isDirectory() || depth >= 3) {
      return;
    }
    const children = await fs.readdir(currentPath);
    for (const child of children.sort()) {
      await walk(path.posix.join(currentPath, child), depth + 1);
    }
  }
  await walk(payload.rootPath);
  process.stdout.write(JSON.stringify({ entries }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, { rootPath }, { timeoutMs: 30000 }).then((result) => result.entries || []);
  }

  async function readContainerFile(filePath) {
    const result = await runObserverToolContainerNode(`
const fs = require("fs/promises");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const content = await fs.readFile(payload.filePath, "utf8");
  process.stdout.write(JSON.stringify({ content }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, { filePath }, { timeoutMs: 30000 });
    return String(result.content || "");
  }

  async function readContainerFileBuffer(target) {
    return runObserverToolContainerNode(`
const fs = require("fs/promises");
async function main() {
  const payload = JSON.parse(await new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input || "{}"));
    process.stdin.on("error", reject);
  }));
  const stats = await fs.stat(payload.target);
  const bytes = await fs.readFile(payload.target);
  process.stdout.write(JSON.stringify({
    path: payload.target,
    size: stats.size,
    contentBase64: bytes.toString("base64")
  }));
}
main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`, { target }, { timeoutMs: 30000 });
  }

  return {
    listContainerFiles,
    quotePowerShellString,
    quoteShellPath,
    readContainerFile,
    readContainerFileBuffer,
    runGatewayShell,
    stripAnsi
  };
}
