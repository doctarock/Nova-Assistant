export function isActivitySummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what have you been up to|what have you been working on|what have you been doing|what'?s been happening|status update|recent activity|what did you do|tell me what you.*up to|what work has been completed today|what work was completed today|what has been completed today|tell me what work has been completed today|tell me what was completed today|completed today|work summary|summary of work|summary of today(?:'s)? workloads?|today(?:'s)? workloads? summary|today(?:'s)? workload summary|what have you completed today|what did you complete today|tell me what you completed today|how'?s it going|what'?s new|give me an update|any updates|what happened today|what happened recently|what'?s going on|catch me up|anything new|what'?s the latest|fill me in|morning report|end of day report|what'?s been going on|bring me up to speed|update me|what have you done today|what did you get done|what'?s been done today|give me a rundown|what'?s the status|daily summary|activity report|progress update|progress report|tell me what'?s been happening|what'?s happening)\b/.test(lower);
}

export function isQueueStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what.?s in the queue|what is in the queue|queue status|what tasks are queued|what.?s queued|what is queued|what are you working on|current task|current tasks|in progress|what jobs are running|how many tasks are waiting|how many tasks are queued|how many jobs are queued|what is waiting right now|is anything running|any active tasks|how busy are you|any jobs running|anything in progress|anything running|what.?s pending|any pending tasks|anything pending|how many tasks|tasks? status|task queue|job queue|what.?s in progress|what jobs are there|are there any tasks|any tasks running|any tasks waiting|what.?s being worked on|are you working on anything|what.?s next in queue|whats? the queue look like)\b/.test(lower);
}

export function isTimeRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what time is it|current time|what.?s the time|what is the time|tell me the time|time please|time check|give me the time|what.?s the current time|do you have the time|clock)\b/.test(lower);
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
  return /\b(what.?s the date|what is the date|today.?s date|current date|what day is it|what.?s today.?s date|what day is today|what.?s today|today.?s date please|what.?s the date today|what month is it|what year is it)\b/.test(lower);
}

export function isMailStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(mailbox access|email access|mail access|inbox access|do you have mailbox|can you send email|can you read email|mail status|email status|is mail set up|is email set up|is email configured|is mail configured|mailbox status|email set up|mail set up|do you have email|do you have mail access|email ready|mail ready|is your mail working|is email working)\b/.test(lower);
}

export function isInboxSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(summary of emails|summary of email|emails in the inbox|email inbox|inbox summary|summar(?:y|ise) emails|summar(?:y|ise) inbox|tell me about .*emails|update me on .*emails|today'?s emails|todays emails|check my email|any new emails|any emails|check email|email update|do i have mail|new mail|any new messages|check inbox|any messages in the inbox|show me (?:my )?emails|what emails do i have|any unread emails|unread emails|read my emails|what.?s in my inbox|inbox emails|new emails?|recent emails?|latest emails?|show inbox)\b/.test(lower);
}

export function isTodayInboxSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(today'?s emails|todays emails|emails today|email today|today inbox|emails from today|new emails today|what emails came in today|any emails today|did i get any emails today|did i get mail today|mail today)\b/.test(lower);
}

export function isOutputStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(observer-output|output folder|output directory|generated files|what files did you create|what files have you created|what did you put in the output|show me the output|what have you made|what files are there|list output files|show output|what.?s in (?:the )?output|show me the files|what files do you have|any output files|list (?:the )?output|what did you generate|what has been generated|files you created|files you.?ve created|what.?s been generated)\b/.test(lower);
}

export function isCompletionSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(last completed task|what did you finish|what completed|what have you completed|recent completions|anything done|what just finished|what.?s been done|last task done|anything completed|what finished recently|recent work done|what tasks finished|tasks completed|recently completed|what did you just do|what did you last do|what.?s done|jobs done|what got done|what.?s been completed|what have you done|latest completed|most recently completed)\b/.test(lower);
}

export function isFailureSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(what failed|failed tasks|recent failures|did anything fail|which jobs failed|which tasks failed|any errors|any issues|what went wrong|any problems|anything broken|any failures|did anything break|any failed tasks|any failed jobs|what errors occurred|were there any failures|anything go wrong|any task errors|task failures|job failures|failed jobs|failed recently)\b/.test(lower);
}

export function isDocumentOverviewRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(document overview|documents overview|document status|workspace documents|tracked documents|document index|show me (?:my )?documents|list (?:my )?documents|what documents do you have|my documents|show documents|list documents|what files are in the workspace|workspace files overview|what.?s in the workspace)\b/.test(lower);
}

export function isDailyBriefingRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(daily briefing|today'?s briefing|brief me|day briefing|today summary|morning briefing|start of day briefing|what should i know today|morning update|morning rundown|start of day update|today.?s summary|give me (?:a )?briefing|run me through today|what.?s on for today|start of day|begin(?:ning) of day|daily summary|daily update|end of day summary|eod summary|day summary)\b/.test(lower);
}

export function isFinanceSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(finance summary|financial summary|spending summary|income summary|expense summary|finance report|financial report|my finances|show (?:my )?finances|show (?:my )?expenses|show (?:my )?spending|finance tracker|finance status|financial status|finance overview|money summary|how much have i spent|how much money|budget summary|ledger summary|show ledger|what.?s in the ledger|tracked expenses|tracked income|finance entries|income and expenses?|expenses? and income|show me (?:my )?finances|what.?s my financial situation|what have i spent)\b/.test(lower);
}

export function isProjectStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(project status|project overview|active projects|workspace projects|what projects|show projects|list projects|project summary|project pipelines?|project progress|what.?s (?:in|on) the workspace|project board|how many projects|current projects|ongoing projects|what.?s being worked on in (?:the )?workspace|tell me about (?:the )?projects?)\b/.test(lower);
}

export function isScheduledJobsRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(scheduled jobs?|scheduled tasks?|cron jobs?|cron tasks?|scheduled runs?|what.?s scheduled|show scheduled|list scheduled|recurring jobs?|recurring tasks?|periodic jobs?|periodic tasks?|automations?|background jobs?|what runs automatically|what.?s set to run|automation status|cron status|scheduled job status)\b/.test(lower);
}

export function isHelpRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  if (lower.length > 60) {
    return false;
  }
  return /^(?:help|help me|help please|what can you do|what can you do\?|what are your commands|what do you know|what commands do you have|what are you capable of|what.?s your capabilities|show me what you can do|list your commands|list commands|what.?s available|what can i ask you|what can i ask|how can you help|how can i use you|what do you support|capabilities please|commands please|features please|what features do you have)\.?$/.test(lower)
    || /^(?:help|usage|commands?|features?)$/.test(lower);
}

export function isSystemStatusRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  return /\b(system status|plugin status|health status|are you healthy|how are you (?:doing|running|feeling)|system health|observer status|observer health|are (?:you|the plugins?) running|what plugins are (?:loaded|enabled|active|running)|show plugins|list plugins|loaded plugins|active plugins|plugin list|what.?s loaded|system check|health check|is everything ok|is everything running|are all plugins enabled)\b/.test(lower);
}

export function isCalendarSummaryRequest(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  if (/\b(calendar|agenda|schedule|appointments?|meetings?|events?)\b/.test(lower)
    && /\b(what'?s on|what is on|show|list|today|tomorrow|upcoming|this week|my|do i have|any)\b/.test(lower)) {
    return true;
  }
  if (/\b(what do i have (?:on |planned |scheduled )?today|anything on today|what.?s on my calendar|any meetings today|schedule for today|what.?s on today|what have i got today|what.?s planned today|anything scheduled today|what.?s happening today|do i have any meetings|what.?s my schedule|any appointments today)\b/.test(lower)) {
    return true;
  }
  return false;
}

export function getCalendarSummaryScopeFromMessage(message = "") {
  const lower = String(message || "").toLowerCase().trim();
  if (/\btomorrow\b/.test(lower)) return "tomorrow";
  if (/\bthis week\b|\bweek ahead\b/.test(lower)) return "week";
  if (/\btoday\b/.test(lower)) return "today";
  return "upcoming";
}

/**
 * Returns true when a message looks like a conversational follow-up that
 * requires prior context to resolve correctly. Used to decide whether to
 * bypass the stateless native fast-path and let the LLM handle it with
 * session history instead.
 *
 * Rules of thumb:
 *  - Very short messages (≤6 words) that aren't a standalone question
 *  - Starts with a pronoun or demonstrative referencing something prior
 *  - Continuation words ("and", "also", "but", "what about", "how about")
 *  - "again", "same", "that", "this", "it", "them" without a clear noun
 *  - Pure affirmatives/negatives that imply context ("yes", "no", "ok",
 *    "sure", "never mind", "forget it")
 */
export function looksLikeFollowUpMessage(message = "", recentExchanges = []) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!text) return false;

  // Must have at least one prior turn to follow up on
  if (!recentExchanges.length) return false;

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Short pure affirmatives / negatives / acknowledgements
  if (/^(yes|no|ok|okay|sure|nope|yep|yeah|nah|alright|got it|fine|never mind|forget it|skip it|thanks|thank you|great|perfect|sounds good|done|go ahead|proceed|continue|stop|cancel|quit|exit)\.?$/i.test(text)) {
    return true;
  }

  // Starts with a continuation or contrastive connector
  if (/^(and |also |but |though |however |what about |how about |what if |and if |so |then |now |plus |even |still |yet |actually |actually,|oh |oh,|wait |wait,|hang on|by the way|one more|another|same for |same with |same thing|do the same|try again|try that again|do it again|do that again|run it again)/i.test(lower)) {
    return true;
  }

  // Bare pronoun opening referencing prior subject
  if (/^(it |its |it's |they |them |their |that |this |those |these |he |she |his |her )/i.test(lower) && wordCount <= 10) {
    return true;
  }

  // Follow-up question words without enough standalone context
  if (/^(what about |how about |which one|which ones|can you |could you |would you |will you |did it |was it |is it |are they |were they |does it |do they )/i.test(lower) && wordCount <= 8) {
    return true;
  }

  // "Again", "same", "that one", "the other one" etc.
  if (/\b(again|same (?:thing|one|request|question)|the (?:same|other|first|second|last|previous)|that one|this one|the one|do that|like that|as before|as discussed|we discussed|you mentioned|you said)\b/i.test(lower) && wordCount <= 12) {
    return true;
  }

  // Very short messages (≤4 words) that aren't a clear standalone command
  if (wordCount <= 4 && !/^(what time|what date|what day|queue status|show tasks|list tasks|help|restart|stop|cancel)/i.test(lower)) {
    return true;
  }

  return false;
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
