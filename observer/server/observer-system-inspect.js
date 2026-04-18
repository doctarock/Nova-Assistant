import { spawn } from "child_process";

const MAX_COMMAND_OUTPUT_CHARS = 512 * 1024; // 512 KB per stream

export function runCommand(command, args, { input, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout = null;

    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");

    p.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_COMMAND_OUTPUT_CHARS) {
        stdout += chunk;
        if (stdout.length > MAX_COMMAND_OUTPUT_CHARS) {
          stdout = stdout.slice(0, MAX_COMMAND_OUTPUT_CHARS) + "\n[stdout truncated]";
        }
      }
    });

    p.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_COMMAND_OUTPUT_CHARS) {
        stderr += chunk;
        if (stderr.length > MAX_COMMAND_OUTPUT_CHARS) {
          stderr = stderr.slice(0, MAX_COMMAND_OUTPUT_CHARS) + "\n[stderr truncated]";
        }
      }
    });

    p.on("error", reject);
    p.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        code: timedOut ? 124 : code,
        stdout: stdout.trim(),
        stderr: timedOut
          ? `${stderr.trim()}${stderr.trim() ? "\n" : ""}Observer timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`
          : stderr.trim(),
        timedOut
      });
    });

    if (input) {
      p.stdin.write(input);
    }
    p.stdin.end();

    if (Number(timeoutMs || 0) > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          p.kill("SIGTERM");
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            p.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 2000);
      }, Number(timeoutMs));
    }
  });
}

export async function inspectContainer(name) {
  const result = await runCommand("docker", [
    "inspect",
    name,
    "--format",
    "{{json .State}}"
  ]);

  if (result.code !== 0) {
    return { name, exists: false, running: false, error: result.stderr || "not found" };
  }

  try {
    const state = JSON.parse(result.stdout);
    return {
      name,
      exists: true,
      running: Boolean(state?.Running),
      status: state?.Status || "unknown",
      startedAt: state?.StartedAt || null,
      exitCode: state?.ExitCode ?? null
    };
  } catch {
    return {
      name,
      exists: true,
      running: false,
      status: "unknown",
      error: "failed to parse docker inspect output"
    };
  }
}

export async function queryGpuStatus() {
  const result = await runCommand("nvidia-smi", [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
    "--format=csv,noheader,nounits"
  ]);

  if (result.code !== 0) {
    return {
      available: false,
      error: result.stderr || "nvidia-smi failed"
    };
  }

  const line = result.stdout.split(/\r?\n/).find(Boolean);
  if (!line) {
    return {
      available: false,
      error: "no gpu data returned"
    };
  }

  const [name, utilizationGpu, memoryUsed, memoryTotal, temperatureGpu] = line.split(",").map((value) => value.trim());
  return {
    available: true,
    name,
    utilizationGpu: Number(utilizationGpu),
    memoryUsedMiB: Number(memoryUsed),
    memoryTotalMiB: Number(memoryTotal),
    temperatureC: Number(temperatureGpu)
  };
}

export function shouldHideInspectorEntry(entryName) {
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
