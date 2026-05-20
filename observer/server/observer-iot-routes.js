import path from "path";

export function registerObserverIotRoutes({
  app,
  dirname,
  iotDomain,
  noteInteractiveActivity = () => {}
} = {}) {
  const iotSecretsTabPath = path.join(dirname, "server", "plugins", "iot", "public", "iot-secrets-tab.js");

  app.get("/api/plugin-ui/iot/secrets-tab.js", (_req, res) => {
    res.type("application/javascript");
    res.sendFile(iotSecretsTabPath);
  });

  app.get("/api/iot/instances", async (_req, res) => {
    try {
      res.json({ ok: true, instances: await iotDomain.listInstances() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list instances") });
    }
  });

  app.post("/api/iot/instances", async (req, res) => {
    try {
      noteInteractiveActivity();
      res.json({ ok: true, instance: await iotDomain.saveInstance(req.body || {}) });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save instance") });
    }
  });

  app.delete("/api/iot/instances/:instanceId", async (req, res) => {
    try {
      noteInteractiveActivity();
      const instanceId = String(req.params?.instanceId || "").trim();
      if (!instanceId) {
        return res.status(400).json({ ok: false, error: "instanceId is required" });
      }
      res.json({ ok: true, removed: await iotDomain.removeInstance({ instanceId }) });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove instance") });
    }
  });

  app.post("/api/iot/instances/:instanceId/test", async (req, res) => {
    try {
      const instanceId = String(req.params?.instanceId || "").trim();
      const result = await iotDomain.testConnection({ instanceId, ...(req.body || {}) });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err?.message || err || "connection test failed") });
    }
  });
}
