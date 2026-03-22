export function isActivitySummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what have you been up to|what have you been working on|what have you been doing|what's been happening|status update|recent activity|what did you do|tell me what you.*up to|what work has been completed today|what work was completed today|what has been completed today|tell me what work has been completed today|tell me what was completed today|completed today|work summary|summary of work|summary of today(?:'s)? workloads?|today(?:'s)? workloads? summary|today(?:'s)? workload summary|what have you completed today|what did you complete today|tell me what you completed today)\b/.test(lower);
}

export function isQueueStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what.?s in the queue|what is in the queue|queue status|what tasks are queued|what.?s queued|what is queued|what are you working on|current task|current tasks|in progress|what jobs are running|how many tasks are waiting|how many tasks are queued|how many jobs are queued|what is waiting right now)\b/.test(lower);
}

export function isTimeRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what time is it|current time|what.?s the time|what is the time|tell me the time|time please)\b/.test(lower);
}

export function isCapabilityCheckRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(can you|could you|are you able to|do you have|do you support|are you capable of|will you be able to|can you access|can you use|can you update)\b/.test(lower);
}

export function isUserIdentityRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(who is your user|who am i|who is the user|who are you helping|who do you work for|who is your human)\b/.test(lower);
}

export function normalizeIntakeReplyText({ message = "", action = "enqueue", replyText = "" } = {}) {
  const raw = String(replyText || "").trim();
  if (action !== "enqueue") {
    return raw;
  }
  const capabilityCheck = isCapabilityCheckRequest(message);
  if (capabilityCheck) {
    return "I need to verify that properly. I'll take a closer look now.";
  }
  if (!raw) {
    return "I'll take a closer look now.";
  }
  if (/^(no|nope|not yet|i do not|i don't|can't|cannot)\b/i.test(raw) || /\b(other half|worker|brain|qwen worker)\b/i.test(raw)) {
    return "I'll take a closer look now.";
  }
  return raw
    .replace(/\bQwen worker\b/gi, "deeper pass")
    .replace(/\bworker\b/gi, "deeper pass")
    .replace(/\bother half\b/gi, "deeper pass")
    .replace(/\bbrain\b/gi, "process");
}

export function isLightweightPlannerReplyRequest(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (/\bevery\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text) || /\bin\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text)) {
    return false;
  }
  if (/\b(read|inspect|open|search|look through|compare .* file|write to|create file|run|test|debug|fix|implement|refactor|code)\b/.test(text)) {
    return false;
  }
  return /\b(help me phrase|phrase a|better titles?|how should i structure|good next step|what should i say|rewrite this sentence|word this)\b/.test(text);
}

export function intakeMessageExplicitlyRequestsScheduling(message = "") {
  const text = String(message || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  if (/\b(?:every|in)\s+\d+\s*(?:ms|s|m|h|d)\b/.test(text)) {
    return true;
  }
  return /\b(schedule|scheduled|cron|recurring|repeat|repeating|periodic|daily|weekly|monthly|hourly|nightly|background job|remind me)\b/.test(text);
}

export function shapePlannerTaskMessage(message = "") {
  const raw = String(message || "").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.toLowerCase();
  const readAndWriteMatch = raw.match(/^read\s+(.+?)\s+and\s+write\s+(.+)$/i);
  if (readAndWriteMatch) {
    const source = String(readAndWriteMatch[1] || "").trim();
    const outcome = String(readAndWriteMatch[2] || "").trim().replace(/\.$/, "");
    return compactTaskText(`Inspect ${source}. Produce ${outcome}. Base the result on concrete content from the source instead of generic assumptions.`, 280);
  }
  const compareMatch = raw.match(/^compare\s+(.+?)\s+and\s+create\s+(.+)$/i);
  if (compareMatch) {
    const leftRight = String(compareMatch[1] || "").trim();
    const outcome = String(compareMatch[2] || "").trim().replace(/\.$/, "");
    return compactTaskText(`Compare ${leftRight}. Identify the key overlap and differences, then create ${outcome} as a concrete deliverable.`, 280);
  }
  if (/^inspect\b/i.test(raw) && /\bidentify\b/i.test(raw)) {
    return compactTaskText(`${raw} Base the result on named inspected targets and concrete findings.`, 280);
  }
  return compactTaskText(`${raw} Produce a concrete outcome, not just a status note.`, 280);
}

export function looksLikeFileListSummary(text = "") {
  const raw = String(text || "").trim();
  if (!raw) {
    return true;
  }
  if (/^No text response\. Generated files:/i.test(raw)) {
    return true;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fileishLines = lines.filter((line) => /\.[A-Za-z0-9]{1,8}\b/.test(line) || /[\\/]/.test(line));
  return lines.length > 0 && fileishLines.length >= Math.max(2, Math.ceil(lines.length * 0.6));
}

export function normalizeSummaryComparisonText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeLowSignalCompletionSummary(summary = "", task = {}) {
  const rawSummary = String(summary || "").trim();
  if (!rawSummary) {
    return true;
  }
  const normalizedSummary = normalizeSummaryComparisonText(rawSummary);
  const taskMessage = String(task?.originalMessage || task?.message || "").trim();
  const normalizedTask = normalizeSummaryComparisonText(taskMessage);
  const taskLead = normalizedTask.slice(0, 120);
  if (normalizedTask && taskLead && normalizedSummary.includes(taskLead)) {
    return true;
  }
  if (
    /^(i finished|i completed|i wrapped up)\b/i.test(rawSummary)
    && (
      /\badvance the project\b/i.test(rawSummary)
      || /\/home\/openclaw\/\.observer-sandbox\/workspace\//i.test(rawSummary)
      || /\bstart by reviewing\b/i.test(rawSummary)
    )
  ) {
    return true;
  }
  return false;
}

export function looksLikeCapabilityRefusalCompletionSummary(summary = "") {
  const rawSummary = String(summary || "").trim();
  if (!rawSummary) {
    return false;
  }
  return [
    /\bi am unable to\b/i,
    /\bi can't\b/i,
    /\bi cannot\b/i,
    /\bunable to assist\b/i,
    /\bcurrent capabilities are limited\b/i,
    /\bcapabilities are limited\b/i,
    /\bi do not have the ability to\b/i,
    /\bi don't have the ability to\b/i,
    /\bas an ai\b/i,
    /\bi cannot generate, review, or summarize\b/i
  ].some((pattern) => pattern.test(rawSummary));
}

export function isDateRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what.?s the date|what is the date|today.?s date|current date|what day is it)\b/.test(lower);
}

export function isMailStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(mailbox access|email access|mail access|inbox access|do you have mailbox|can you send email|can you read email|mail status|email status)\b/.test(lower);
}

export function isInboxSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(summary of emails|summary of email|emails in the inbox|email inbox|inbox summary|summar(y|ise) emails|summar(y|ise) inbox|tell me about .*emails|update me on .*emails|today'?s emails|todays emails)\b/.test(lower);
}

export function isTodayInboxSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(today'?s emails|todays emails|emails today|email today|today inbox)\b/.test(lower);
}

export function isOutputStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(observer-output|output folder|output directory|generated files|what files did you create|what files have you created|what did you put in the output)\b/.test(lower);
}

export function isCompletionSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(last completed task|what did you finish|what completed|what have you completed|recent completions)\b/.test(lower);
}

export function isFailureSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what failed|failed tasks|recent failures|did anything fail|which jobs failed|which tasks failed)\b/.test(lower);
}

export function isDocumentOverviewRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(document overview|documents overview|document status|workspace documents|tracked documents|document index)\b/.test(lower);
}

export function isDailyBriefingRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(daily briefing|today'?s briefing|brief me|day briefing|today summary)\b/.test(lower);
}

export function isCalendarSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(calendar|agenda|schedule)\b/.test(lower)
    && /\b(what'?s on|what is on|show|list|today|tomorrow|upcoming|this week|my)\b/.test(lower);
}

export function getCalendarSummaryScopeFromMessage(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  if (/\btomorrow\b/.test(lower)) return "tomorrow";
  if (/\bthis week\b|\bweek ahead\b/.test(lower)) return "week";
  if (/\btoday\b/.test(lower)) return "today";
  return "upcoming";
}

export function compactTaskText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
