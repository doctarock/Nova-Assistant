import crypto from "crypto";

export function summarizePayloadText(parsed) {
  if (parsed == null) {
    return "";
  }
  if (typeof parsed === "string") {
    return parsed.trim();
  }
  if (parsed && typeof parsed === "object") {
    const payloads = Array.isArray(parsed.result?.payloads)
      ? parsed.result.payloads
      : Array.isArray(parsed.payloads)
        ? parsed.payloads
        : [];
    const payloadText = payloads
      .map((payload) => String(payload?.text || "").trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (payloadText) {
      return payloadText;
    }
    const candidates = [
      parsed.summary,
      parsed.message,
      parsed.text,
      parsed.response,
      parsed.output,
      parsed.final_text,
      parsed.result?.final_text,
      parsed.result?.reply_text,
      parsed.result?.assistant_message,
      parsed.assistant_message
    ];
    for (const candidate of candidates) {
      if (candidate == null || typeof candidate === "object") {
        continue;
      }
      const text = String(candidate || "").trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function hasMeaningfulTextResponse(runResponse) {
  const summary = summarizePayloadText(runResponse?.parsed);
  if (summary) {
    return true;
  }
  const raw = String(runResponse?.text || runResponse?.stdout || "").trim();
  return raw.length > 0;
}

export function summarizeRunArtifacts(runResponse) {
  const artifacts = Array.isArray(runResponse?.artifacts) ? runResponse.artifacts : [];
  if (!artifacts.length) {
    return "";
  }
  return artifacts
    .slice(0, 3)
    .map((artifact) => String(artifact?.path || artifact?.name || "").trim())
    .filter(Boolean)
    .join(", ");
}

export function formatElapsedShort(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
}

export function hashRef(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

export function formatTaskCodename(id) {
  const hash = hashRef(id);
  const adjectives = ["amber", "blue", "bright", "calm", "clear", "green", "quiet", "silver", "swift", "violet"];
  const nouns = ["anchor", "bridge", "comet", "forge", "harbor", "lantern", "meadow", "signal", "summit", "thread"];
  const first = Number.parseInt(hash.slice(0, 4), 16);
  const second = Number.parseInt(hash.slice(4, 8), 16);
  const suffix = hash.slice(8, 12);
  return `${adjectives[first % adjectives.length]}-${nouns[second % nouns.length]}-${suffix}`;
}

export function formatJobCodename(id) {
  return formatTaskCodename(`job:${id}`);
}

export function formatEntityRef(kind = "", id = "") {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind === "job" || normalizedKind === "cron") {
    return formatJobCodename(id || "unknown");
  }
  if (normalizedKind === "task") {
    return formatTaskCodename(id || "unknown");
  }
  return formatTaskCodename(`${normalizedKind || "entity"}:${id || "unknown"}`);
}

export function normalizeTaskRecord(task = {}) {
  const normalized = { ...(task && typeof task === "object" ? task : {}) };
  normalized.id = String(normalized.id || "").trim();
  normalized.codename = normalized.codename || formatTaskCodename(normalized.id || "unknown");
  normalized.message = String(normalized.message || "").trim();
  normalized.status = String(normalized.status || "queued").trim();
  normalized.createdAt = Number(normalized.createdAt || Date.now());
  normalized.updatedAt = Number(normalized.updatedAt || normalized.createdAt || Date.now());
  normalized.attempts = Math.max(0, Number(normalized.attempts || 0));
  normalized.meta = normalized.meta && typeof normalized.meta === "object" ? normalized.meta : {};
  return normalized;
}
