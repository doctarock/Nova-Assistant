export function registerMailCalendarRoutes(context = {}) {
  const app = context.app;

  app.get("/api/calendar/events", async (req, res) => {
    try {
      const events = await context.listCalendarEvents();
      res.json({ ok: true, events });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/calendar/events", async (req, res) => {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const startAt = context.parseCalendarTimestamp(payload.startAt, 0);
      if (!startAt) {
        return res.status(400).json({ ok: false, error: "startAt is required" });
      }
      const savedEvent = await context.saveCalendarEvent({
        id: payload.id,
        title: payload.title,
        description: payload.description,
        location: payload.location,
        type: payload.type,
        status: payload.status,
        allDay: payload.allDay === true,
        startAt,
        endAt: context.parseCalendarTimestamp(payload.endAt, 0),
        repeat: payload.repeat,
        action: payload.action
      });
      res.json({
        ok: true,
        event: savedEvent,
        message: payload.id ? "Calendar event updated." : "Calendar event created."
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/calendar/events/:eventId/state", async (req, res) => {
    try {
      const eventId = String(req.params?.eventId || "").trim();
      if (!eventId) {
        return res.status(400).json({ ok: false, error: "eventId is required" });
      }
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!["active", "completed", "cancelled"].includes(status)) {
        return res.status(400).json({ ok: false, error: "status must be active, completed, or cancelled" });
      }
      const existing = (await context.readCalendarEvents()).find((entry) => String(entry.id || "") === eventId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: "calendar event not found" });
      }
      const now = Date.now();
      const savedEvent = await context.saveCalendarEvent({
        ...existing,
        status,
        completedAt: status === "completed" ? now : 0,
        cancelledAt: status === "cancelled" ? now : 0
      });
      res.json({ ok: true, event: savedEvent, message: `Calendar event marked ${status}.` });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/calendar/events/:eventId", async (req, res) => {
    try {
      const eventId = String(req.params?.eventId || "").trim();
      if (!eventId) {
        return res.status(400).json({ ok: false, error: "eventId is required" });
      }
      const removed = await context.removeCalendarEvent(eventId);
      if (!removed) {
        return res.status(404).json({ ok: false, error: "calendar event not found" });
      }
      res.json({ ok: true, message: "Calendar event deleted." });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/mail/status", async (req, res) => {
    try {
      const activeAgent = context.getActiveMailAgent();
      if (await context.hasMailCredentials(activeAgent) && !context.mailState.highestUidByAgent[activeAgent.id]) {
        await context.fetchRecentMessagesForAgent(activeAgent, { limit: 10, initializeOnly: true });
      }
      res.json({
        ok: true,
        ...(await context.buildMailStatus(activeAgent)),
        messages: context.mailState.recentMessages
          .filter((entry) => entry.agentId === activeAgent?.id)
          .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0))
          .slice(0, 12)
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, ...(await context.buildMailStatus()) });
    }
  });

  app.post("/api/mail/poll", async (req, res) => {
    try {
      const messages = await context.pollActiveMailbox({ emitEvents: true });
      res.json({ ok: true, count: messages.length, messages });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/mail/send", async (req, res) => {
    const toEmail = String(req.body?.toEmail || req.body?.email || req.body?.to || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!context.looksLikeEmailAddress(toEmail) || !text) {
      return res.status(400).json({ ok: false, error: "toEmail and text are required" });
    }
    try {
      const result = await context.sendAgentMail({ toEmail, subject, text });
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/mail/move", async (req, res) => {
    const destination = String(req.body?.destination || req.body?.action || "").trim().toLowerCase();
    const messageId = String(req.body?.messageId || req.body?.id || "").trim();
    const uid = Number(req.body?.uid || 0);
    const subjectContains = String(req.body?.subjectContains || req.body?.subject || "").trim();
    const fromContains = String(req.body?.fromContains || req.body?.from || req.body?.sender || "").trim();
    const latest = req.body?.latest === true || String(req.body?.latest || "").trim().toLowerCase() === "true";
    if (!destination) {
      return res.status(400).json({ ok: false, error: "destination is required" });
    }
    if (!messageId && !(uid > 0) && !subjectContains && !fromContains && !latest) {
      return res.status(400).json({ ok: false, error: "one of messageId, uid, subjectContains, fromContains, or latest is required" });
    }
    try {
      const result = await context.moveAgentMail({
        destination,
        messageId,
        uid,
        subjectContains,
        fromContains,
        latest
      });
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/mail/summary-setting", async (req, res) => {
    try {
      const enabled = req.body?.enabled !== false;
      const rulesState = context.getMailWatchRulesState();
      rulesState.sendSummariesEnabled = enabled;
      if (Array.isArray(rulesState.rules)) {
        rulesState.rules = rulesState.rules.map((rule) => ({
          ...rule,
          sendSummaries: enabled
        }));
      }
      await context.saveMailWatchRulesState();
      res.json({ ok: true, sendSummariesEnabled: enabled });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/todos", async (req, res) => {
    try {
      const todos = await context.listTodoItems();
      res.json({ ok: true, ...todos });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/todos", async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: "text is required" });
    }
    try {
      context.noteInteractiveActivity();
      const todo = await context.addTodoItem({
        text,
        createdBy: String(req.body?.createdBy || "").trim().toLowerCase() === "nova" ? "nova" : "user",
        source: String(req.body?.source || "api").trim()
      });
      res.json({ ok: true, todo });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/todos/:todoId/state", async (req, res) => {
    const todoId = String(req.params?.todoId || "").trim();
    const status = String(req.body?.status || "completed").trim();
    const sessionId = String(req.body?.sessionId || "Main").trim();
    if (!todoId) {
      return res.status(400).json({ ok: false, error: "todoId is required" });
    }
    try {
      context.noteInteractiveActivity();
      const result = await context.setTodoItemStatus(todoId, status, {
        completedBy: String(req.body?.completedBy || "user").trim(),
        sessionId
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/todos/:todoId/remove", async (req, res) => {
    const todoId = String(req.params?.todoId || "").trim();
    const sessionId = String(req.body?.sessionId || "Main").trim();
    if (!todoId) {
      return res.status(400).json({ ok: false, error: "todoId is required" });
    }
    try {
      context.noteInteractiveActivity();
      const result = await context.removeTodoItem(todoId, {
        removedBy: String(req.body?.removedBy || "user").trim(),
        sessionId
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
