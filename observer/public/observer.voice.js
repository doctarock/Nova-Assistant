function refreshKnownVoices() {
  if (!("speechSynthesis" in window)) {
    knownVoices = [];
    return knownVoices;
  }
  knownVoices = window.speechSynthesis.getVoices();
  return knownVoices;
}

function unlockSpeech() {
  speechUnlocked = true;
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore browser-specific failures
    }
  }
}

const VOICE_FINGERPRINT_SAMPLE_INTERVAL_MS = 120;
const VOICE_FINGERPRINT_RETENTION_MS = 60000;
const VOICE_FINGERPRINT_CAPTURE_MS = 3200;
const VOICE_FINGERPRINT_BINS = 24;
const VOICE_RECOGNITION_HOLD_MS = 60000;

function getConfiguredVoiceTrustProfiles() {
  const profiles = runtimeOptions?.app?.trust?.voiceProfiles;
  return Array.isArray(profiles) ? profiles : [];
}

function hasConfiguredVoiceTrustProfiles() {
  return getConfiguredVoiceTrustProfiles().length > 0;
}

function clearHeldVoiceRecognition() {
  heldVoiceSourceIdentity = null;
  heldVoiceSourceIdentityUntil = 0;
  if (voiceRecognitionHoldTimer) {
    window.clearTimeout(voiceRecognitionHoldTimer);
    voiceRecognitionHoldTimer = null;
  }
}

function holdRecognizedVoiceIdentity(sourceIdentity) {
  if (!sourceIdentity || normalizeTrustLevel(sourceIdentity.trustLevel, "unknown") === "unknown") {
    clearHeldVoiceRecognition();
    return;
  }
  heldVoiceSourceIdentity = { ...sourceIdentity };
  heldVoiceSourceIdentityUntil = Date.now() + VOICE_RECOGNITION_HOLD_MS;
  if (voiceRecognitionHoldTimer) {
    window.clearTimeout(voiceRecognitionHoldTimer);
  }
  voiceRecognitionHoldTimer = window.setTimeout(() => {
    clearHeldVoiceRecognition();
    updateVoiceUi();
  }, VOICE_RECOGNITION_HOLD_MS);
}

function getEffectiveVoiceSourceIdentity() {
  if (heldVoiceSourceIdentity && heldVoiceSourceIdentityUntil > Date.now()) {
    return heldVoiceSourceIdentity;
  }
  if (heldVoiceSourceIdentity) {
    clearHeldVoiceRecognition();
  }
  return latestVoiceSourceIdentity;
}

function formatVoiceSourceIdentity(sourceIdentity = getEffectiveVoiceSourceIdentity()) {
  if (!sourceIdentity) {
    return "";
  }
  const label = String(sourceIdentity.speakerLabel || sourceIdentity.label || "Unknown speaker").trim() || "Unknown speaker";
  const trust = trustLevelLabel(sourceIdentity.trustLevel);
  const similarity = Number(sourceIdentity.similarity || 0);
  return `${label} (${trust}${similarity > 0 ? ` ${Math.round(similarity * 100)}%` : ""})`;
}

function updateVoiceTrustDisplay() {
  if (!voiceTrustEl) {
    return;
  }
  if (!speechRecognitionSupported) {
    voiceTrustEl.className = "voice-trust voice-trust-bad";
    voiceTrustEl.textContent = "Voice trust: unavailable";
    return;
  }
  if (!hasConfiguredVoiceTrustProfiles()) {
    voiceTrustEl.className = "voice-trust voice-trust-warn";
    voiceTrustEl.textContent = "Voice trust: open (no profile)";
    return;
  }
  const effectiveVoiceSourceIdentity = getEffectiveVoiceSourceIdentity();
  const sourceIdentity = effectiveVoiceSourceIdentity && typeof effectiveVoiceSourceIdentity === "object"
    ? effectiveVoiceSourceIdentity
    : null;
  const label = String(sourceIdentity?.speakerLabel || sourceIdentity?.label || "Awaiting speaker").trim() || "Awaiting speaker";
  const trustLevel = normalizeTrustLevel(sourceIdentity?.trustLevel, "unknown");
  const commandsAllowed = shouldAllowVoiceCommand(sourceIdentity);
  const similarity = Number(sourceIdentity?.similarity || 0);
  const suffix = similarity > 0 ? ` ${Math.round(similarity * 100)}%` : "";
  const tone = commandsAllowed
    ? "voice-trust-ok"
    : trustLevel === "unknown"
      ? "voice-trust-bad"
      : "voice-trust-warn";
  voiceTrustEl.className = `voice-trust ${tone}`;
  voiceTrustEl.textContent = `Voice trust: ${trustLevelLabel(trustLevel)} | ${label}${suffix}${commandsAllowed ? " | commands allowed" : " | commands blocked"}`;
}

function getVoiceCommandMinimumLevel() {
  return normalizeTrustLevel(runtimeOptions?.app?.trust?.voiceCommandMinLevel, "trusted");
}

function shouldAllowVoiceCommand(sourceIdentity = getEffectiveVoiceSourceIdentity()) {
  if (!hasConfiguredVoiceTrustProfiles()) {
    return true;
  }
  return isTrustLevelAtLeast(sourceIdentity?.trustLevel, getVoiceCommandMinimumLevel());
}

function normalizeVoiceFingerprint(vector = []) {
  const values = Array.isArray(vector)
    ? vector.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (!values.length) {
    return [];
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
  if (!magnitude) {
    return [];
  }
  return values.map((value) => Number((value / magnitude).toFixed(6)));
}

function averageVoiceFingerprint(vectors = []) {
  const valid = vectors.filter((entry) => Array.isArray(entry) && entry.length);
  if (!valid.length) {
    return [];
  }
  const length = valid[0].length;
  const sums = new Array(length).fill(0);
  for (const vector of valid) {
    for (let index = 0; index < length; index += 1) {
      sums[index] += Number(vector[index] || 0);
    }
  }
  return normalizeVoiceFingerprint(sums.map((value) => value / valid.length));
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    dot += a * b;
    leftMag += a * a;
    rightMag += b * b;
  }
  if (!leftMag || !rightMag) {
    return 0;
  }
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

function sampleVoiceFingerprintFrame() {
  if (!voiceMicAnalyserNode) {
    return;
  }
  const timeData = new Uint8Array(voiceMicAnalyserNode.fftSize);
  voiceMicAnalyserNode.getByteTimeDomainData(timeData);
  let energy = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    energy += Math.abs(timeData[index] - 128);
  }
  const averageEnergy = energy / timeData.length;
  if (averageEnergy < 5) {
    return;
  }
  const freqData = new Uint8Array(voiceMicAnalyserNode.frequencyBinCount);
  voiceMicAnalyserNode.getByteFrequencyData(freqData);
  const capped = freqData.slice(0, Math.min(freqData.length, 240));
  const chunkSize = Math.max(1, Math.floor(capped.length / VOICE_FINGERPRINT_BINS));
  const bins = [];
  for (let index = 0; index < VOICE_FINGERPRINT_BINS; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(capped.length, start + chunkSize);
    let total = 0;
    let count = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      total += capped[cursor];
      count += 1;
    }
    bins.push(count ? total / (count * 255) : 0);
  }
  const normalized = normalizeVoiceFingerprint(bins);
  if (!normalized.length) {
    return;
  }
  const now = Date.now();
  voiceFingerprintFrames.push({ at: now, signature: normalized });
  voiceFingerprintFrames = voiceFingerprintFrames.filter((entry) => now - Number(entry.at || 0) <= VOICE_FINGERPRINT_RETENTION_MS);
}

async function ensureVoiceFingerprintMonitor() {
  if (voiceMicAnalyserNode && voiceMicStream) {
    return;
  }
  if (voiceMicSetupPromise) {
    await voiceMicSetupPromise;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("microphone capture is unavailable in this browser");
  }
  voiceMicSetupPromise = (async () => {
    voiceMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio is unavailable in this browser");
    }
    voiceMicAudioContext = new AudioCtx();
    voiceMicSourceNode = voiceMicAudioContext.createMediaStreamSource(voiceMicStream);
    voiceMicAnalyserNode = voiceMicAudioContext.createAnalyser();
    voiceMicAnalyserNode.fftSize = 1024;
    voiceMicAnalyserNode.smoothingTimeConstant = 0.7;
    voiceMicSourceNode.connect(voiceMicAnalyserNode);
    sampleVoiceFingerprintFrame();
    if (voiceMicSampleTimer) {
      window.clearInterval(voiceMicSampleTimer);
    }
    voiceMicSampleTimer = window.setInterval(sampleVoiceFingerprintFrame, VOICE_FINGERPRINT_SAMPLE_INTERVAL_MS);
  })();
  try {
    await voiceMicSetupPromise;
  } finally {
    voiceMicSetupPromise = null;
  }
}

async function stopVoiceFingerprintMonitor() {
  voiceMicSetupPromise = null;
  if (voiceMicSampleTimer) {
    window.clearInterval(voiceMicSampleTimer);
    voiceMicSampleTimer = null;
  }
  if (voiceMicStream) {
    voiceMicStream.getTracks().forEach((track) => track.stop());
    voiceMicStream = null;
  }
  if (voiceMicAudioContext) {
    try {
      await voiceMicAudioContext.close();
    } catch {
      // ignore browser cleanup failures
    }
    voiceMicAudioContext = null;
  }
  voiceMicSourceNode = null;
  voiceMicAnalyserNode = null;
  voiceFingerprintFrames = [];
}

function getRecentVoiceFingerprint(windowMs = 4500, minAt = 0) {
  const cutoff = Math.max(0, Date.now() - Number(windowMs || 0), Number(minAt || 0));
  const signatures = voiceFingerprintFrames
    .filter((entry) => Number(entry.at || 0) >= cutoff)
    .map((entry) => entry.signature)
    .filter((entry) => Array.isArray(entry) && entry.length);
  return averageVoiceFingerprint(signatures);
}

function matchVoiceFingerprint(signature = []) {
  const normalizedSignature = normalizeVoiceFingerprint(signature);
  if (!normalizedSignature.length) {
    return null;
  }
  let bestMatch = null;
  for (const profile of getConfiguredVoiceTrustProfiles()) {
    const profileSignature = normalizeVoiceFingerprint(profile?.signature);
    if (!profileSignature.length || profileSignature.length !== normalizedSignature.length) {
      continue;
    }
    const similarity = cosineSimilarity(normalizedSignature, profileSignature);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        profile,
        similarity
      };
    }
  }
  if (!bestMatch) {
    return null;
  }
  const threshold = Math.max(0.45, Math.min(Number(bestMatch.profile?.threshold || 0.82), 0.99));
  if (bestMatch.similarity < threshold) {
    return null;
  }
  return {
    speakerId: String(bestMatch.profile?.id || "").trim(),
    speakerLabel: String(bestMatch.profile?.label || "Recognized speaker").trim(),
    trustLevel: normalizeTrustLevel(bestMatch.profile?.trustLevel, "known"),
    similarity: Number(bestMatch.similarity.toFixed(4)),
    threshold
  };
}

function buildVoiceSourceIdentity(match = null) {
  return match
    ? {
        kind: "voice",
        speakerId: match.speakerId,
        speakerLabel: match.speakerLabel,
        label: match.speakerLabel,
        trustLevel: match.trustLevel,
        similarity: match.similarity,
        threshold: match.threshold
      }
    : {
        kind: "voice",
        speakerId: "",
        speakerLabel: "Unknown speaker",
        label: "Unknown speaker",
        trustLevel: "unknown",
        similarity: 0,
        threshold: 0
      };
}

function resolveVoiceSourceIdentityFromSignature(signature = [], { updateHeld = false } = {}) {
  latestVoiceFingerprint = signature;
  const match = matchVoiceFingerprint(signature);
  const sourceIdentity = buildVoiceSourceIdentity(match);
  latestVoiceSourceIdentity = sourceIdentity;
  if (updateHeld && match) {
    holdRecognizedVoiceIdentity(sourceIdentity);
  }
  return sourceIdentity;
}

function resolveCurrentVoiceSourceIdentity() {
  if (heldVoiceSourceIdentity && heldVoiceSourceIdentityUntil > Date.now()) {
    latestVoiceSourceIdentity = heldVoiceSourceIdentity;
    return latestVoiceSourceIdentity;
  }
  if (heldVoiceSourceIdentity) {
    clearHeldVoiceRecognition();
  }
  const signature = getRecentVoiceFingerprint();
  return resolveVoiceSourceIdentityFromSignature(signature, { updateHeld: true });
}

function resolveVoiceSourceIdentityForCommandCapture(startedAt = 0) {
  const startedAtMs = Math.max(0, Number(startedAt || 0));
  const signature = startedAtMs
    ? getRecentVoiceFingerprint(Date.now() - startedAtMs + 300, startedAtMs)
    : getRecentVoiceFingerprint();
  return resolveVoiceSourceIdentityFromSignature(signature, { updateHeld: true });
}

async function captureVoiceTrustProfileSignature({ durationMs = VOICE_FINGERPRINT_CAPTURE_MS } = {}) {
  if (voiceCaptureSession) {
    throw new Error("voice capture is already in progress");
  }
  await ensureVoiceFingerprintMonitor();
  voiceCaptureSession = {
    startedAt: Date.now(),
    durationMs: Math.max(1500, Number(durationMs || VOICE_FINGERPRINT_CAPTURE_MS))
  };
  sampleVoiceFingerprintFrame();
  await new Promise((resolve) => {
    window.setTimeout(resolve, voiceCaptureSession.durationMs);
  });
  sampleVoiceFingerprintFrame();
  const signature = getRecentVoiceFingerprint(voiceCaptureSession.durationMs + 300, voiceCaptureSession.startedAt);
  voiceCaptureSession = null;
  if (!signature.length) {
    throw new Error("no clear voice sample was detected");
  }
  latestVoiceFingerprint = signature;
  latestVoiceSourceIdentity = resolveVoiceSourceIdentityFromSignature(signature, { updateHeld: true });
  updateVoiceUi();
  return signature;
}

function syncVoiceFingerprintMonitor() {
  if (voiceListeningEnabled && speechRecognitionSupported) {
    ensureVoiceFingerprintMonitor().catch((error) => {
      voiceLastError = error?.message || "microphone capture unavailable";
      updateVoiceUi();
    });
    return;
  }
  stopVoiceFingerprintMonitor().catch(() => {
    // ignore cleanup failures
  });
}

function updateVoiceUi() {
  syncVoiceFingerprintMonitor();
  updateVoiceTrustDisplay();
  const effectiveVoiceSourceIdentity = getEffectiveVoiceSourceIdentity();
  const speakerMeta = effectiveVoiceSourceIdentity ? ` | Speaker: ${formatVoiceSourceIdentity(effectiveVoiceSourceIdentity)}` : "";
  if (!speechRecognitionSupported) {
    voiceToggleBtn.disabled = true;
    voiceToggleBtn.textContent = "Voice unavailable";
    setVoiceStatus("Browser speech recognition is unavailable.");
    setVoiceMeta(`This browser does not expose SpeechRecognition.${speakerMeta}`);
    return;
  }
  voiceToggleBtn.disabled = false;
  voiceToggleBtn.textContent = voiceListeningEnabled ? "Disable voice" : "Enable voice";
  if (!voiceListeningEnabled) {
    setVoiceStatus(renderLanguageString("voice.passiveOff", `Passive listening is off. Say <strong>{{botName}}</strong> to begin, then <strong>{{stopPhrase}}</strong> to finish once enabled.`, {
      botName: escapeHtml(getBotName()),
      stopPhrase: escapeHtml(getStopPhrase())
    }));
    setVoiceMeta(`Wake phrase: ${getBotName()} | Stop phrase: ${getStopPhrase()}${speakerMeta}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
    return;
  }
  if (pendingVoiceQuestionTaskId && !voiceWakeActive) {
    const remainingMs = Math.max(0, pendingVoiceQuestionExpiresAt - Date.now());
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const waitingPrompt = pendingVoiceQuestionExpiresAt > Date.now()
      ? `Question waiting. Say <strong>${escapeHtml(getBotName())}</strong> within <strong>${remainingSeconds}s</strong> to answer by voice.`
      : `Question waiting. Say <strong>${escapeHtml(getBotName())}</strong> to answer by voice.`;
    setVoiceStatus(waitingPrompt);
    setVoiceMeta(`Question: ${pendingVoiceQuestionText || "Nova is waiting for your direction."}${speakerMeta}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
    return;
  }
  if (voiceWakeActive) {
    setVoiceStatus(renderLanguageString("voice.listening", `Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.`, {
      stopPhrase: escapeHtml(getStopPhrase())
    }));
    setVoiceMeta(`Last heard: ${voiceLastTranscript || "nothing yet"}${speakerMeta}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
    return;
  }
  setVoiceStatus(renderLanguageString("voice.passiveOn", `Passive listening is on. Say <strong>{{botName}}</strong> to begin.`, {
    botName: escapeHtml(getBotName())
  }));
  setVoiceMeta(`Last heard: ${voiceLastTranscript || "nothing yet"}${speakerMeta}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
}

function resetVoiceCapture() {
  voiceWakeActive = false;
  voiceFinalBuffer = "";
  voiceInterimBuffer = "";
  voiceCommandCaptureStartedAt = 0;
  latestVoiceSourceIdentity = getEffectiveVoiceSourceIdentity() || null;
  updateVoiceUi();
}

function clearPendingVoiceQuestionWindow(options = {}) {
  const preserveStatus = options.preserveStatus === true;
  const preserveQuestionTime = options.preserveQuestionTime === true;
  const preserveTask = options.preserveTask === true;
  if (pendingVoiceQuestionTimer) {
    window.clearTimeout(pendingVoiceQuestionTimer);
    pendingVoiceQuestionTimer = null;
  }
  if (pendingVoiceQuestionArmTimer) {
    window.clearTimeout(pendingVoiceQuestionArmTimer);
    pendingVoiceQuestionArmTimer = null;
  }
  if (!preserveTask) {
    pendingVoiceQuestionTaskId = "";
    pendingVoiceQuestionText = "";
  }
  pendingVoiceQuestionExpiresAt = 0;
  voiceQuestionCaptureActive = false;
  pendingImmediateVoiceQuestionTask = null;
  if (!preserveQuestionTime && typeof setQuestionTimeActive === "function") {
    setQuestionTimeActive(false);
  }
  if (!preserveStatus) {
    updateVoiceUi();
  }
}

function timeoutPendingVoiceQuestionWindow() {
  if (!pendingVoiceQuestionTaskId) {
    return;
  }
  clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true, preserveTask: true });
  setVoiceStatus(`Voice answer window timed out. Say <strong>${escapeHtml(getBotName())}</strong> to answer by voice, or use the Questions section to answer manually.`);
  setVoiceMeta("The follow-up question is still waiting in the queue.");
}

function armPendingVoiceQuestionWindow(task) {
  if (!task?.id || String(task.status || "") !== "waiting_for_user") {
    return;
  }
  if (!voiceListeningEnabled || !speechRecognitionSupported) {
    return;
  }
  pendingVoiceQuestionTaskId = String(task.id || "");
  pendingVoiceQuestionText = String(task.questionForUser || "").trim();
  pendingVoiceQuestionExpiresAt = Date.now() + VOICE_QUESTION_WAKE_TIMEOUT_MS;
  voiceQuestionCaptureActive = false;
  if (pendingVoiceQuestionTimer) {
    window.clearTimeout(pendingVoiceQuestionTimer);
  }
  pendingVoiceQuestionTimer = window.setTimeout(() => {
    timeoutPendingVoiceQuestionWindow();
  }, VOICE_QUESTION_WAKE_TIMEOUT_MS);
  updateVoiceUi();
}

function maybeStartVoiceQuestionWindow(task) {
  if (!task?.id || String(task.status || "") !== "waiting_for_user") {
    return;
  }
  if (!voiceListeningEnabled || !speechRecognitionSupported) {
    return;
  }
  if (pendingVoiceQuestionArmTimer) {
    window.clearTimeout(pendingVoiceQuestionArmTimer);
  }
  const attemptArm = () => {
    if (activeUtterance || queueDisplayActive) {
      pendingVoiceQuestionArmTimer = window.setTimeout(attemptArm, 200);
      return;
    }
    pendingVoiceQuestionArmTimer = null;
    armPendingVoiceQuestionWindow(task);
  };
  pendingVoiceQuestionArmTimer = window.setTimeout(attemptArm, 120);
}

function requestImmediateVoiceQuestionCapture(task) {
  if (!task?.id || String(task.status || "") !== "waiting_for_user") {
    return;
  }
  pendingImmediateVoiceQuestionTask = task;
  if (!voicePausedForTts) {
    window.setTimeout(() => {
      if (pendingImmediateVoiceQuestionTask && typeof beginImmediateVoiceQuestionCapture === "function") {
        const pendingTask = pendingImmediateVoiceQuestionTask;
        pendingImmediateVoiceQuestionTask = null;
        beginImmediateVoiceQuestionCapture(pendingTask);
      }
    }, 60);
  }
}

function beginImmediateVoiceQuestionCapture(task) {
  if (!task?.id || String(task.status || "") !== "waiting_for_user") {
    return;
  }
  if (!voiceListeningEnabled || !speechRecognitionSupported) {
    return;
  }
  armPendingVoiceQuestionWindow(task);
  voiceWakeActive = true;
  voiceCommandCaptureStartedAt = Date.now();
  voiceQuestionCaptureActive = true;
  voiceFinalBuffer = "";
  voiceInterimBuffer = "";
  voiceSubmissionCooldownUntil = 0;
  voiceStopRequested = false;
  if (voiceRestartTimer) {
    window.clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch {
      // ignore restart races
    }
    window.setTimeout(() => {
      voiceStopRequested = false;
      startVoiceListeningNow();
      scheduleVoiceRestart(400);
      playRecordingStartBeep();
    }, 80);
  }
  updateVoiceUi();
  setVoiceStatus(renderLanguageString("voice.listening", `Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.`, {
    stopPhrase: escapeHtml(getStopPhrase())
  }));
  setVoiceMeta(`Question: ${pendingVoiceQuestionText || "Nova is waiting for your direction."}`);
}

function playWakeChime() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  try {
    if (!wakeAudioContext) {
      wakeAudioContext = new AudioCtx();
    }
    const ctx = wakeAudioContext;
    const now = ctx.currentTime;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const gain = ctx.createGain();

    oscA.type = "sine";
    oscA.frequency.setValueAtTime(740, now);
    oscA.frequency.exponentialRampToValueAtTime(988, now + 0.14);

    oscB.type = "triangle";
    oscB.frequency.setValueAtTime(988, now + 0.08);
    oscB.frequency.exponentialRampToValueAtTime(1318, now + 0.22);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(now);
    oscA.stop(now + 0.18);
    oscB.start(now + 0.06);
    oscB.stop(now + 0.28);
  } catch {
    // ignore audio init/playback failures
  }
}

function playRecordingStartBeep() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }
  try {
    if (!wakeAudioContext) {
      wakeAudioContext = new AudioCtx();
    }
    const ctx = wakeAudioContext;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1174, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.17);
  } catch {
    // ignore audio init/playback failures
  }
}

function scheduleVoiceRestart(delayMs = 300) {
  if (!voiceListeningEnabled || voiceStopRequested) {
    return;
  }
  if (voiceRestartTimer) {
    window.clearTimeout(voiceRestartTimer);
  }
  voiceRestartTimer = window.setTimeout(() => {
    voiceRestartTimer = null;
    startVoiceListeningNow();
  }, delayMs);
}

function startVoiceListeningNow() {
  if (!voiceListeningEnabled || voiceStopRequested || voicePausedForTts || !speechRecognition) {
    return;
  }
  try {
    speechRecognition.start();
  } catch {
    // browser may still be settling after end/error
  }
}

function pauseVoiceListeningForTts() {
  if (!speechRecognitionSupported || !speechRecognition || !voiceListeningEnabled) {
    return;
  }
  voicePausedForTts = true;
  voiceStopRequested = true;
  if (voiceRestartTimer) {
    window.clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  try {
    speechRecognition.stop();
  } catch {
    // ignore stop races
  }
}

function resumeVoiceListeningAfterTts() {
  if (!voicePausedForTts) {
    return;
  }
  voicePausedForTts = false;
  if (!voiceListeningEnabled) {
    return;
  }
  if (pendingImmediateVoiceQuestionTask && typeof beginImmediateVoiceQuestionCapture === "function") {
    const task = pendingImmediateVoiceQuestionTask;
    pendingImmediateVoiceQuestionTask = null;
    beginImmediateVoiceQuestionCapture(task);
    return;
  }
  voiceStopRequested = false;
  resetVoiceCapture();
  updateVoiceUi();
  window.setTimeout(() => {
    startVoiceListeningNow();
    scheduleVoiceRestart(400);
  }, 250);
}

function mergeVoiceTranscript(existingText, nextText) {
  const existing = String(existingText || "").trim();
  const next = String(nextText || "").trim();
  if (!existing) return next;
  if (!next) return existing;
  const normalizeToken = (token) => normalizeVoiceText(token).replace(/s\b/g, "");
  const existingTokens = existing.split(/\s+/).filter(Boolean);
  const nextTokens = next.split(/\s+/).filter(Boolean);
  const commonPrefixCount = (() => {
    const max = Math.min(existingTokens.length, nextTokens.length);
    let count = 0;
    for (let index = 0; index < max; index += 1) {
      if (normalizeToken(existingTokens[index]) !== normalizeToken(nextTokens[index])) {
        break;
      }
      count += 1;
    }
    return count;
  })();
  if (commonPrefixCount >= 2) {
    if (nextTokens.length >= existingTokens.length) {
      return next;
    }
    if (existingTokens.length >= nextTokens.length) {
      return existing;
    }
  }
  if (next.startsWith(existing)) return next;
  if (existing.startsWith(next)) return existing;
  if (existing.includes(next)) return existing;
  if (next.includes(existing)) return next;

  const maxOverlap = Math.min(existing.length, next.length);
  for (let size = maxOverlap; size >= 8; size -= 1) {
    if (existing.slice(-size).toLowerCase() === next.slice(0, size).toLowerCase()) {
      return `${existing}${next.slice(size)}`.trim();
    }
  }
  return `${existing} ${next}`.replace(/\s+/g, " ").trim();
}

function stripVoiceWakePrefix(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "";
  }
  return source
    .replace(new RegExp(`^\\s*${escapeRegExp(getBotName())}\\b`, "i"), "")
    .replace(/^[:,.!?\s-]+/, "")
    .trim();
}

function stripTrailingStopVariants(text) {
  let stripped = String(text || "").trim();
  if (!stripped) {
    return "";
  }
  for (const variant of getStopPhraseVariants()) {
    const trailingStopPattern = new RegExp(`(?:\\b${escapeRegExp(variant)}\\b[,.!?\\s-]*)+$`, "i");
    stripped = stripped.replace(trailingStopPattern, " ").trim();
  }
  return stripped.replace(/\s+/g, " ").trim();
}

function stripVoiceStopPhrase(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "";
  }
  return stripTrailingStopVariants(source);
}

function endsWithStopPhrase(text) {
  const normalized = normalizeVoiceText(text);
  if (!normalized) {
    return false;
  }
  return getStopPhraseVariants().some((variant) => normalized.endsWith(variant));
}

function collapseRepeatedVoicePhrases(text) {
  const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }

  const normalizedTokens = tokens.map((token) => normalizeVoiceText(token));
  const output = [];
  let index = 0;

  while (index < tokens.length) {
    let collapsed = false;
    const maxPhraseSize = Math.min(5, Math.floor((tokens.length - index) / 2));
    for (let size = maxPhraseSize; size >= 2; size -= 1) {
      const left = normalizedTokens.slice(index, index + size).join(" ");
      const right = normalizedTokens.slice(index + size, index + (size * 2)).join(" ");
      if (left && left === right) {
        output.push(...tokens.slice(index, index + size));
        index += size * 2;
        while (index + size <= tokens.length && normalizedTokens.slice(index, index + size).join(" ") === left) {
          index += size;
        }
        collapsed = true;
        break;
      }
    }
    if (collapsed) {
      continue;
    }
    const current = tokens[index];
    const previous = output[output.length - 1];
    if (!previous || normalizeVoiceText(previous) !== normalizeVoiceText(current)) {
      output.push(current);
    }
    index += 1;
  }

  return output.join(" ");
}

function trimRepeatedLeadIn(text) {
  let tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 8) {
    return String(text || "").trim();
  }

  let changed = true;
  while (changed) {
    changed = false;
    const normalizedTokens = tokens.map((token) => normalizeVoiceText(token));
    const maxPrefixSize = Math.min(10, Math.floor(tokens.length / 2));
    for (let size = maxPrefixSize; size >= 4; size -= 1) {
      const prefix = normalizedTokens.slice(0, size).join(" ");
      let repeatedAt = -1;
      for (let index = size; index <= normalizedTokens.length - size; index += 1) {
        if (normalizedTokens.slice(index, index + size).join(" ") === prefix) {
          repeatedAt = index;
        }
      }
      if (repeatedAt > 0) {
        tokens = tokens.slice(repeatedAt);
        changed = true;
        break;
      }
    }
  }

  return tokens.join(" ");
}

function normalizeVoiceCommandText(text, { stripThank = false } = {}) {
  let cleaned = collapseRepeatedVoicePhrases(
    trimRepeatedLeadIn(String(text || "").trim())
  )
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (stripThank) {
    cleaned = cleaned.replace(/\bthank\b[,.!?\s-]*$/i, "").trim();
  }
  return cleaned;
}

function sanitizeVoiceCaptureText(text) {
  return normalizeVoiceCommandText(
    stripVoiceStopPhrase(
      stripVoiceWakePrefix(text)
    )
  );
}

function finalizeVoiceSubmissionText() {
  const rawMerged = mergeVoiceTranscript(voiceFinalBuffer, voiceInterimBuffer);
  return normalizeVoiceCommandText(
    stripTrailingStopVariants(stripVoiceWakePrefix(rawMerged)),
    { stripThank: true }
  );
}

function buildVoiceSubmissionText() {
  const committed = sanitizeVoiceCaptureText(voiceFinalBuffer);
  const interim = sanitizeVoiceCaptureText(voiceInterimBuffer);
  if (!committed) {
    return interim;
  }
  if (!interim) {
    return committed;
  }
  return sanitizeVoiceCaptureText(mergeVoiceTranscript(committed, interim));
}

function submitVoicePrompt(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    resetVoiceCapture();
    return;
  }
  const captureStartedAt = voiceCommandCaptureStartedAt;
  const sourceIdentity = resolveVoiceSourceIdentityForCommandCapture(captureStartedAt);
  if (!shouldAllowVoiceCommand(sourceIdentity)) {
    resetVoiceCapture();
    setVoiceStatus(`Voice command blocked from <strong>${escapeHtml(formatVoiceSourceIdentity(sourceIdentity) || "Unknown speaker")}</strong>.`);
    setVoiceMeta(`Minimum level for voice commands is ${trustLevelLabel(getVoiceCommandMinimumLevel())}. Capture or trust a speaker profile in Nova settings.`);
    window.setTimeout(() => {
      if (voiceListeningEnabled && !voicePausedForTts) {
        startVoiceListeningNow();
        scheduleVoiceRestart(VOICE_RESTART_AFTER_SUBMIT_MS);
      }
    }, VOICE_RESTART_AFTER_SUBMIT_MS);
    return;
  }
  voiceSubmissionCooldownUntil = Date.now() + VOICE_SUBMISSION_COOLDOWN_MS;
  voiceLastTranscript = cleaned;
  resetVoiceCapture();
  if (voiceRestartTimer) {
    window.clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  if (speechRecognition) {
    voiceStopRequested = true;
    try {
      speechRecognition.stop();
    } catch {
      voiceStopRequested = false;
    }
  }
  if (runInFlight || runBtn.disabled) {
    pendingSubmissionPrompts.push({
      text: cleaned,
      sourceIdentity
    });
    setVoiceStatus(renderLanguageString("voice.capturedQueued", `Captured request queued: <strong>{{text}}</strong>`, {
      text: escapeHtml(cleaned)
    }));
    setVoiceMeta(`${renderLanguageString("voice.capturedQueuedMeta", "Nova will send this when ready.")} Speaker: ${formatVoiceSourceIdentity(sourceIdentity) || "Unknown speaker"}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
    window.setTimeout(() => {
      if (voiceListeningEnabled && !voicePausedForTts) {
        startVoiceListeningNow();
        scheduleVoiceRestart(VOICE_RESTART_AFTER_SUBMIT_MS);
      }
    }, VOICE_RESTART_AFTER_SUBMIT_MS);
    return;
  }
  document.getElementById("msg").value = cleaned;
  setVoiceStatus(renderLanguageString("voice.capturedRequest", `Captured request: <strong>{{text}}</strong>`, {
    text: escapeHtml(cleaned)
  }));
  setVoiceMeta(`${renderLanguageString("voice.capturedSubmitted", "Captured request submitted.")} Speaker: ${formatVoiceSourceIdentity(sourceIdentity) || "Unknown speaker"}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
  window.setTimeout(() => {
    startAgentRun(cleaned, { sourceIdentity }).catch((error) => {
      payloadsEl.innerHTML = `<div class="payload">Request failed: ${escapeHtml(error.message)}</div>`;
      resultEl.textContent = String(error);
      hintEl.textContent = "Voice submission failed before a response was returned.";
    });
  }, 120);
  window.setTimeout(() => {
    if (voiceListeningEnabled && !voicePausedForTts) {
      startVoiceListeningNow();
      scheduleVoiceRestart(VOICE_RESTART_AFTER_SUBMIT_MS);
    }
  }, VOICE_RESTART_AFTER_SUBMIT_MS);
}

async function submitVoiceFollowUpAnswer(text) {
  const cleaned = String(text || "").trim();
  const taskId = String(pendingVoiceQuestionTaskId || "").trim();
  if (!cleaned || !taskId) {
    resetVoiceCapture();
    return;
  }
  const captureStartedAt = voiceCommandCaptureStartedAt;
  const sourceIdentity = resolveVoiceSourceIdentityForCommandCapture(captureStartedAt);
  if (!shouldAllowVoiceCommand(sourceIdentity)) {
    resetVoiceCapture();
    clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true, preserveTask: true });
    setVoiceStatus(`Voice answer blocked from <strong>${escapeHtml(formatVoiceSourceIdentity(sourceIdentity) || "Unknown speaker")}</strong>.`);
    setVoiceMeta(`Minimum level for voice answers is ${trustLevelLabel(getVoiceCommandMinimumLevel())}.`);
    window.setTimeout(() => {
      if (voiceListeningEnabled && !voicePausedForTts) {
        startVoiceListeningNow();
        scheduleVoiceRestart(VOICE_RESTART_AFTER_SUBMIT_MS);
      }
    }, VOICE_RESTART_AFTER_SUBMIT_MS);
    return;
  }
  voiceSubmissionCooldownUntil = Date.now() + VOICE_SUBMISSION_COOLDOWN_MS;
  voiceLastTranscript = cleaned;
  resetVoiceCapture();
  clearPendingVoiceQuestionWindow({ preserveStatus: true, preserveQuestionTime: true });
  if (voiceRestartTimer) {
    window.clearTimeout(voiceRestartTimer);
    voiceRestartTimer = null;
  }
  if (speechRecognition) {
    voiceStopRequested = true;
    try {
      speechRecognition.stop();
    } catch {
      voiceStopRequested = false;
    }
  }
  setVoiceStatus(`Captured answer: <strong>${escapeHtml(cleaned)}</strong>`);
  setVoiceMeta("Sending follow-up answer to Nova.");
  try {
    const r = await fetch("/api/tasks/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        answer: cleaned,
        sessionId: document.getElementById("sessionId")?.value || "Main"
      })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "failed to answer task");
    }
    hintEl.textContent = "Voice answer saved and the task has been re-queued.";
    await loadTaskQueue();
    if (!questionTimeActive && typeof setQuestionTimeActive === "function") {
      setQuestionTimeActive(false);
    }
  } catch (error) {
    if (typeof setQuestionTimeActive === "function") {
      setQuestionTimeActive(false);
    }
    hintEl.textContent = `Voice follow-up failed: ${error.message}`;
    setVoiceStatus("Voice follow-up failed. Use the Questions section to answer.");
    setVoiceMeta(error.message);
  }
  window.setTimeout(() => {
    if (voiceListeningEnabled && !voicePausedForTts) {
      startVoiceListeningNow();
      scheduleVoiceRestart(VOICE_RESTART_AFTER_SUBMIT_MS);
    }
  }, VOICE_RESTART_AFTER_SUBMIT_MS);
}

function flushPendingSubmissionPrompt() {
  if (runInFlight || runBtn.disabled || !pendingSubmissionPrompts.length) {
    return;
  }
  let nextPrompt = pendingSubmissionPrompts.shift();
  while (
    pendingSubmissionPrompts.length
    && String((pendingSubmissionPrompts[0] && typeof pendingSubmissionPrompts[0] === "object" ? pendingSubmissionPrompts[0].text : pendingSubmissionPrompts[0]) || "") === String((nextPrompt && typeof nextPrompt === "object" ? nextPrompt.text : nextPrompt) || "")
  ) {
    pendingSubmissionPrompts.shift();
  }
  const nextText = String((nextPrompt && typeof nextPrompt === "object" ? nextPrompt.text : nextPrompt) || "").trim();
  const nextSourceIdentity = nextPrompt && typeof nextPrompt === "object" ? nextPrompt.sourceIdentity : null;
  if (!nextText) {
    return;
  }
  document.getElementById("msg").value = nextText;
  setVoiceStatus(renderLanguageString("voice.sendingQueued", `Sending queued request: <strong>{{text}}</strong>`, {
    text: escapeHtml(nextText)
  }));
  setVoiceMeta(`${renderLanguageString("voice.queuedSubmitted", "Queued request submitted.")}${nextSourceIdentity ? ` Speaker: ${formatVoiceSourceIdentity(nextSourceIdentity)}` : ""}${voiceLastError ? ` | Last error: ${voiceLastError}` : ""}`);
  window.setTimeout(() => {
    startAgentRun(nextText, nextSourceIdentity ? { sourceIdentity: nextSourceIdentity } : {}).catch((error) => {
      payloadsEl.innerHTML = `<div class="payload">Request failed: ${escapeHtml(error.message)}</div>`;
      resultEl.textContent = String(error);
      hintEl.textContent = "Queued submission failed before a response was returned.";
    });
  }, 120);
}

function getVoicePreviewText() {
  return sanitizeVoiceCaptureText(mergeVoiceTranscript(voiceFinalBuffer, voiceInterimBuffer));
}

function getVoiceStopDetectionText() {
  return stripVoiceWakePrefix(
    mergeVoiceTranscript(voiceFinalBuffer, voiceInterimBuffer)
  );
}

function handleVoiceTranscript(text, isFinal) {
  if (voiceStopRequested || Date.now() < voiceSubmissionCooldownUntil) {
    return;
  }
  const transcript = String(text || "").trim();
  if (!transcript) {
    return;
  }
  voiceLastTranscript = transcript;
  const normalizedTranscript = normalizeVoiceText(transcript);
  const wakePhrase = normalizeVoiceText(getWakePhrase());
  const stopPhrase = normalizeVoiceText(getStopPhrase());

  if (!voiceWakeActive) {
    const wakeIndex = normalizedTranscript.indexOf(wakePhrase);
    if (wakeIndex >= 0) {
      if (hasConfiguredVoiceTrustProfiles()) {
        resolveCurrentVoiceSourceIdentity();
      }
      voiceWakeActive = true;
      voiceCommandCaptureStartedAt = Date.now();
      if (pendingVoiceQuestionTaskId) {
        voiceQuestionCaptureActive = true;
        if (pendingVoiceQuestionTimer) {
          window.clearTimeout(pendingVoiceQuestionTimer);
          pendingVoiceQuestionTimer = null;
        }
      }
      if (typeof window.ObserverApp?.speakWakeAcknowledgement === "function") {
        window.ObserverApp.speakWakeAcknowledgement("Yes.");
      }
      const afterWake = sanitizeVoiceCaptureText(transcript);
      if (isFinal) {
        voiceFinalBuffer = mergeVoiceTranscript("", afterWake);
        voiceInterimBuffer = "";
      } else {
        voiceFinalBuffer = "";
        voiceInterimBuffer = mergeVoiceTranscript(voiceInterimBuffer, afterWake);
      }
      updateVoiceUi();
      const previewText = getVoicePreviewText();
      if (previewText) {
        setVoiceStatus(renderLanguageString("voice.listeningHeard", `Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.<br><strong>Heard:</strong> {{previewText}}`, {
          stopPhrase: escapeHtml(stopPhrase),
          previewText: escapeHtml(previewText)
        }));
      }
    } else if (!isFinal) {
      updateVoiceUi();
    }
    return;
  }

  const stopHeardInChunk = endsWithStopPhrase(stripVoiceWakePrefix(transcript));
  const cleanedTranscript = sanitizeVoiceCaptureText(transcript);
  if (isFinal) {
    const mergedInterim = mergeVoiceTranscript(voiceFinalBuffer, voiceInterimBuffer);
    voiceFinalBuffer = mergeVoiceTranscript(mergedInterim, cleanedTranscript);
    voiceInterimBuffer = "";
  } else {
    voiceInterimBuffer = mergeVoiceTranscript(voiceInterimBuffer, cleanedTranscript);
  }
  const previewText = getVoicePreviewText();
  if (stopHeardInChunk || endsWithStopPhrase(getVoiceStopDetectionText())) {
    const finalText = (finalizeVoiceSubmissionText() || buildVoiceSubmissionText()).replace(/[,.!?;:\s-]+$/, "");
    if (voiceQuestionCaptureActive && pendingVoiceQuestionTaskId) {
      submitVoiceFollowUpAnswer(finalText);
    } else {
      submitVoicePrompt(finalText);
    }
    return;
  }

  if (!isFinal) {
    setVoiceStatus(renderLanguageString("voice.listeningHeard", `Listening for your request. Say <strong>{{stopPhrase}}</strong> to finish.<br><strong>Heard:</strong> {{previewText}}`, {
      stopPhrase: escapeHtml(stopPhrase),
      previewText: escapeHtml(previewText)
    }));
  }
}

function initVoiceRecognition() {
  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    speechRecognitionSupported = false;
    updateVoiceUi();
    return;
  }

  speechRecognitionSupported = true;
  speechRecognition = new RecognitionCtor();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = /^en/i.test(navigator.language || "") ? navigator.language : "en-US";

  speechRecognition.onstart = () => {
    voiceLastError = "";
    updateVoiceUi();
  };

  speechRecognition.onresult = (event) => {
    if (voiceStopRequested) {
      return;
    }
    let interimTranscript = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (voiceStopRequested) {
        return;
      }
      const result = event.results[index];
      const transcript = String(result[0]?.transcript || "").trim();
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        handleVoiceTranscript(transcript, true);
      } else {
        interimTranscript = mergeVoiceTranscript(interimTranscript, transcript);
      }
    }
    if (interimTranscript) {
      handleVoiceTranscript(interimTranscript, false);
    }
  };

  speechRecognition.onerror = (event) => {
    const errorCode = String(event?.error || "");
    if (errorCode === "no-speech" || errorCode === "aborted") {
      voiceLastError = "";
    } else if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
      voiceListeningEnabled = false;
      voiceStopRequested = true;
      voiceLastError = "microphone permission denied";
    } else if (errorCode === "audio-capture") {
      voiceListeningEnabled = false;
      voiceStopRequested = true;
      voiceLastError = "no microphone available";
    } else {
      voiceLastError = errorCode ? `recognition error: ${errorCode}` : "recognition error";
    }
    updateVoiceUi();
    if (voiceStopRequested) {
      return;
    }
    if (errorCode !== "not-allowed" && errorCode !== "service-not-allowed" && errorCode !== "audio-capture") {
      scheduleVoiceRestart(errorCode === "no-speech" ? 1200 : 800);
    }
  };

  speechRecognition.onend = () => {
    if (voiceStopRequested) {
      voiceStopRequested = false;
      if (voicePausedForTts) {
        return;
      }
      updateVoiceUi();
      return;
    }
    scheduleVoiceRestart(350);
  };

  updateVoiceUi();
}

window.maybeStartVoiceQuestionWindow = maybeStartVoiceQuestionWindow;
window.beginImmediateVoiceQuestionCapture = beginImmediateVoiceQuestionCapture;
window.requestImmediateVoiceQuestionCapture = requestImmediateVoiceQuestionCapture;
window.clearPendingVoiceQuestionWindow = clearPendingVoiceQuestionWindow;
Object.assign(observerApp, {
  captureVoiceTrustProfileSignature,
  getCurrentVoiceSourceIdentity: resolveCurrentVoiceSourceIdentity,
  formatVoiceSourceIdentity,
  shouldAllowVoiceCommand
});
