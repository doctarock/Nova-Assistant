export function createSessionConversationStore({
  maxExchanges = 10,
  expireMs = 2 * 60 * 60 * 1000,
  recentWindow = 8,
  now = () => Date.now()
} = {}) {
  const sessionConversationStore = new Map();

  function getSessionHistory(sessionId = "Main") {
    const key = String(sessionId || "Main").trim() || "Main";
    const entry = sessionConversationStore.get(key);
    if (!entry) {
      return [];
    }
    if (now() - Number(entry.lastAt || 0) > expireMs) {
      sessionConversationStore.delete(key);
      return [];
    }
    const exchanges = entry.exchanges.slice();
    if (exchanges.length <= recentWindow) {
      return exchanges;
    }

    const older = exchanges.slice(0, exchanges.length - recentWindow);
    const recent = exchanges.slice(exchanges.length - recentWindow);
    const summaryParts = [];
    let i = 0;
    while (i < older.length) {
      const turn = older[i];
      if (turn.role === "user") {
        const userSnippet = String(turn.text || "").slice(0, 80).replace(/\s+/g, " ");
        const next = older[i + 1];
        const agentSnippet = next?.role === "agent"
          ? String(next.text || "").replace(/\s+/g, " ").slice(0, 80)
          : "";
        const actionLabel = next?.action === "enqueue" ? " → queued"
          : next?.action === "clarify" ? " → asked clarification"
          : agentSnippet ? ` → ${agentSnippet}` : "";
        summaryParts.push(`"${userSnippet}"${actionLabel}`);
        i += next?.role === "agent" ? 2 : 1;
      } else {
        i += 1;
      }
    }
    if (!summaryParts.length) {
      return recent;
    }
    const summaryExchange = {
      role: "agent",
      text: `[Earlier in this session: ${summaryParts.join("; ")}]`,
      ts: older[0]?.ts || now(),
      action: "summary"
    };
    return [summaryExchange, ...recent];
  }

  function appendSessionExchange(sessionId = "Main", { userText = "", agentText = "", action = "" } = {}) {
    const key = String(sessionId || "Main").trim() || "Main";
    const user = String(userText || "").trim();
    const agent = String(agentText || "").trim();
    if (!user && !agent) {
      return;
    }
    const entry = sessionConversationStore.get(key) || { exchanges: [], lastAt: 0 };
    const timestamp = now();
    if (user) {
      entry.exchanges.push({ role: "user", text: user, ts: timestamp });
    }
    if (agent) {
      const agentEntry = { role: "agent", text: agent, ts: timestamp };
      if (action) {
        agentEntry.action = action;
      }
      entry.exchanges.push(agentEntry);
    }
    while (entry.exchanges.length > maxExchanges * 2) {
      entry.exchanges.shift();
    }
    entry.lastAt = timestamp;
    sessionConversationStore.set(key, entry);
  }

  return {
    appendSessionExchange,
    getSessionHistory
  };
}
