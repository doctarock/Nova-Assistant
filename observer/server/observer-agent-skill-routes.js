export function registerAgentSkillRoutes({
  app,
  agentSkillsService,
  noteInteractiveActivity = () => {}
} = {}) {
  app.get("/api/agent-skills", async (_req, res) => {
    try {
      const skills = await agentSkillsService.listSkills();
      res.json({ ok: true, skills });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list agent skills") });
    }
  });

  app.get("/api/agent-skills/search", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim();
      const skills = await agentSkillsService.searchSkills(query);
      res.json({ ok: true, query, skills });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err || "failed to search agent skills") });
    }
  });

  app.get("/api/agent-skills/:id", async (req, res) => {
    try {
      const skill = await agentSkillsService.getSkill(req.params.id);
      if (!skill) return res.status(404).json({ ok: false, error: "Skill not found" });
      res.json({ ok: true, skill });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err || "failed to get agent skill") });
    }
  });

  app.post("/api/agent-skills/:id/run", async (req, res) => {
    try {
      noteInteractiveActivity();
      const skillId = req.params.id;
      const { input, brainId } = req.body || {};
      if (!String(input || "").trim()) {
        return res.status(400).json({ ok: false, error: "input is required" });
      }
      const result = await agentSkillsService.runSkill(skillId, input, brainId || undefined);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err || "failed to run agent skill") });
    }
  });
}
