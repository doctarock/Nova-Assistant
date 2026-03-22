export function registerWorkerExecutionRoutes(context = {}) {
  const app = context.app;

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

      const target = scope === "workspace"
        ? context.resolveContainerInspectablePath(file)
        : context.resolveInspectablePath(scope, file);
      const content = scope === "workspace"
        ? await context.readContainerFile(target)
        : await context.readVolumeFile(target);
      res.json({ ok: true, scope, file, path: target, content });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/state/reset-simple-project", async (req, res) => {
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
