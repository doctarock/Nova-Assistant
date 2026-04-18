export function registerWorkerExecutionRoutes(context = {}) {
  const app = context.app;
  const QUEUE_FOLDERS = ["inbox", "in_progress", "done", "closed"];

  function normalizePathSlashes(value = "") {
    return String(value || "").replaceAll("\\", "/");
  }

  function isMissingFileError(error) {
    if (!error) {
      return false;
    }
    const code = String(error.code || "").trim().toUpperCase();
    if (code === "ENOENT") {
      return true;
    }
    const message = String(error.message || "").toLowerCase();
    return message.includes("enoent") || message.includes("no such file");
  }

  async function tryReadRelocatedQueueTaskFile(file = "") {
    const normalizedFile = normalizePathSlashes(file).trim().replace(/^\/+/, "");
    const fileName = context.path.posix.basename(normalizedFile);
    if (!/^task-\d+\.json$/i.test(fileName)) {
      return null;
    }

    const requestedFolder = normalizedFile.split("/")[0] || "";
    for (const folder of QUEUE_FOLDERS) {
      if (folder === requestedFolder) {
        continue;
      }
      const candidateFile = `${folder}/${fileName}`;
      const candidateTarget = context.resolveInspectablePath("queue", candidateFile);
      try {
        const content = await context.readVolumeFile(candidateTarget);
        return {
          file: candidateFile,
          path: candidateTarget,
          content
        };
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
    }
    return null;
  }

  app.get("/api/inspect/tree", async (req, res) => {
    const scope = String(req.query.scope || "workspace");

    try {
      const root = scope === "workspace"
        ? context.observerContainerWorkspaceRoot
        : context.resolveInspectablePath(scope);
      const rawEntries = scope === "workspace"
        ? await context.listContainerFiles(root)
        : await context.listVolumeFiles(root);
      const entries = rawEntries.map((entry) => {
        const entryPath = String(entry.path || "");
        const normalizedPath = entryPath.replaceAll("\\", "/");
        const normalizedRoot = String(root || "").replaceAll("\\", "/");
        const relativePath = normalizedPath === normalizedRoot
          ? "."
          : normalizedPath.startsWith(`${normalizedRoot}/`)
            ? normalizedPath.slice(normalizedRoot.length + 1)
            : entryPath;
        return {
          ...entry,
          relativePath
        };
      });
      res.json({ ok: true, scope, root, entries });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/inspect/file", async (req, res) => {
    const scope = String(req.query.scope || "workspace");
    const file = String(req.query.file || "");

    try {
      if (!file) {
        throw new Error("file is required");
      }

      let target = scope === "workspace"
        ? context.resolveContainerInspectablePath(file)
        : context.resolveInspectablePath(scope, file);
      let content = "";
      let resolvedFile = file;
      let relocated = false;
      if (scope === "workspace") {
        content = await context.readContainerFile(target);
      } else {
        try {
          content = await context.readVolumeFile(target);
        } catch (error) {
          if (scope !== "queue" || !isMissingFileError(error)) {
            throw error;
          }
          const relocatedMatch = await tryReadRelocatedQueueTaskFile(file);
          if (!relocatedMatch) {
            throw error;
          }
          target = relocatedMatch.path;
          content = relocatedMatch.content;
          resolvedFile = relocatedMatch.file;
          relocated = resolvedFile !== file;
        }
      }
      res.json({
        ok: true,
        scope,
        file: resolvedFile,
        requestedFile: file,
        path: target,
        relocated,
        content
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/state/reset-simple-project", async (req, res) => {
    const token = String(req.headers["x-admin-token"] || "").trim();
    if (!token || token !== context.adminUiToken) {
      return res.status(403).json({ ok: false, error: "This action is only available via the UI." });
    }
    try {
      const result = await context.resetToSimpleProjectState();
      res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/output/list", async (req, res) => {
    try {
      const files = await context.listObserverOutputFiles();
      res.json({ ok: true, root: context.observerOutputRoot, files });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/output/file", async (req, res) => {
    try {
      const file = String(req.query.file || "");
      if (!file) {
        throw new Error("file is required");
      }
      const target = context.resolveObserverOutputPath(file);
      await context.fs.access(target);
      res.setHeader("Content-Disposition", `attachment; filename="${context.path.basename(target).replace(/"/g, "")}"`);
      res.type(context.path.extname(target) || "text/plain");
      res.sendFile(target);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/regressions/list", async (req, res) => {
    try {
      const latest = context.getLatestRegressionRunReport() || await context.loadLatestRegressionRunReport();
      res.json({
        ok: true,
        activeRun: context.getActiveRegressionRun(),
        suites: context.listRegressionSuites(),
        latest
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/regressions/latest", async (req, res) => {
    try {
      const latest = context.getLatestRegressionRunReport() || await context.loadLatestRegressionRunReport();
      res.json({
        ok: true,
        activeRun: context.getActiveRegressionRun(),
        latest
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/regressions/run", async (req, res) => {
    try {
      const suiteId = String(req.body?.suiteId || "all").trim() || "all";
      const report = await context.runRegressionSuites(suiteId);
      res.json({
        ok: true,
        activeRun: context.getActiveRegressionRun(),
        report
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}
