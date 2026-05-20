(() => {
const observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  pickLanguageVariant,
  renderPassivePayload,
  showQueuedUpdate
} = observerApp;
function stopPayloadSpeech() {
  const shouldResumeVoice = voicePausedForTts && voiceListeningEnabled;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
  pendingUtteranceChunks = [];
  speechCompletionHandler = null;
  if (window.agentAvatar?.endSpeech) {
    window.agentAvatar.endSpeech();
  }
  if (shouldResumeVoice) {
    window.setTimeout(() => resumeVoiceListeningAfterTts(), 120);
  }
}

function chooseVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = refreshKnownVoices();
  const configuredPreferences = Array.isArray(runtimeOptions?.app?.voicePreferences)
    ? runtimeOptions.app.voicePreferences
    : [];

  for (const preferredName of configuredPreferences) {
    const exactMatch = voices.find((voice) => voice.name.toLowerCase() === preferredName.toLowerCase());
    if (exactMatch) {
      return exactMatch;
    }
    const partialMatch = voices.find((voice) => `${voice.name} ${voice.voiceURI}`.toLowerCase().includes(preferredName.toLowerCase()));
    if (partialMatch) {
      return partialMatch;
    }
  }

  return voices.find((voice) => /zira/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /catherine/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /aria|jenny|libby|natasha|sonia|hazel/i.test(voice.name))
    || voices.find((voice) => /female|woman/i.test(`${voice.name} ${voice.voiceURI}`))
    || voices.find((voice) => /en(-|_)?GB/i.test(voice.lang))
    || voices.find((voice) => /en(-|_)?AU/i.test(voice.lang))
    || voices.find((voice) => /en(-|_)?US/i.test(voice.lang))
    || voices.find((voice) => /english/i.test(`${voice.name} ${voice.lang}`))
    || voices[0]
    || null;
}

function splitIntoSpeechChunks(text, maxLen = 280) {
  if (text.length <= maxLen) return [text];
  const parts = text.split(/([.!?]+)\s+/);
  const sentences = [];
  for (let index = 0; index < parts.length; index += 2) {
    const sentence = ((parts[index] || "") + (parts[index + 1] || "")).trim();
    if (sentence) sentences.push(sentence);
  }
  if (!sentences.length) return [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxLen) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function presentPayloadSpeech(rawText, options = {}) {
  const prepared = window.agentAvatar?.prepareResponseText
    ? window.agentAvatar.prepareResponseText(rawText)
    : {
        cleanText: window.agentAvatar?.stripTags ? window.agentAvatar.stripTags(rawText) : rawText,
        spokenText: window.agentAvatar?.stripTags ? window.agentAvatar.stripTags(rawText) : rawText,
        clipNames: []
      };
  const cleanText = String(prepared.spokenText || prepared.cleanText || "").trim();

  stopPayloadSpeech();

  const voiceCaptureActive = Boolean(voiceListeningEnabled && (voiceWakeActive || voiceFinalBuffer || voiceInterimBuffer));

  if (!cleanText) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  if (voiceCaptureActive && options.bypassVoiceCaptureBlock !== true) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  if (!("speechSynthesis" in window)) {
    window.agentAvatar?.applyResponseText?.(rawText);
    options.onComplete?.();
    return;
  }

  const completeSpeechAttempt = () => {
    const handler = speechCompletionHandler;
    speechCompletionHandler = null;
    handler?.();
    window.setTimeout(() => {
      showQueuedUpdate();
    }, 80);
  };

  // Split into sentence-sized chunks to avoid Chrome/Edge TTS cutoff on long responses
  const chunks = splitIntoSpeechChunks(cleanText);
  pendingUtteranceChunks = chunks.slice(1);
  let avatarStarted = false;

  const speakChunk = (chunkText, attempt = 0) => {
    const utterance = new SpeechSynthesisUtterance(chunkText);
    const voice = chooseVoice();
    let started = false;
    let retryTimer = null;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-AU";
    } else {
      utterance.lang = "en-AU";
    }
    utterance.rate = 1.16;
    utterance.pitch = 1;
    utterance.onstart = () => {
      started = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (!avatarStarted) {
        avatarStarted = true;
        if (options.bypassVoiceCaptureBlock !== true) {
          pauseVoiceListeningForTts();
        }
        options.onStart?.();
        window.agentAvatar?.beginSpeech?.(prepared.clipNames);
      }
    };
    utterance.onend = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      const next = pendingUtteranceChunks.shift();
      if (next !== undefined) {
        window.setTimeout(() => speakChunk(next), 50);
      } else {
        window.agentAvatar?.endSpeech?.();
        if (options.bypassVoiceCaptureBlock !== true) {
          resumeVoiceListeningAfterTts();
        }
        completeSpeechAttempt();
      }
    };
    utterance.onerror = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      if (!started && attempt < 1) {
        window.setTimeout(() => speakChunk(chunkText, attempt + 1), 180);
        return;
      }
      pendingUtteranceChunks = [];
      window.agentAvatar?.endSpeech?.();
      if (options.bypassVoiceCaptureBlock !== true) {
        resumeVoiceListeningAfterTts();
      }
      completeSpeechAttempt();
    };

    activeUtterance = utterance;

    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore browser-specific failures
    }
    window.speechSynthesis.speak(utterance);

    retryTimer = window.setTimeout(() => {
      if (!started && activeUtterance === utterance && attempt < 1) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore browser-specific failures
        }
        activeUtterance = null;
        window.setTimeout(() => speakChunk(chunkText, attempt + 1), 180);
      }
    }, speechUnlocked ? 1200 : 1800);
  };

  speechCompletionHandler = typeof options.onComplete === "function" ? options.onComplete : null;
  window.setTimeout(() => speakChunk(chunks[0]), 50);
}

function speakAcknowledgement(text) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    renderPassivePayload("Acknowledged", text);
    presentPayloadSpeech(text, {
      onStart: () => {
        window.setTimeout(finish, 220);
      },
      onComplete: finish
    });
    window.setTimeout(finish, 500);
  });
}

function speakWakeAcknowledgement(text) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }
  renderPassivePayload("Acknowledged", message);
  presentPayloadSpeech(message, {
    bypassVoiceCaptureBlock: true
  });
}

function queueAcknowledgement(text) {
  let message = String(text || "").trim();
  if (message === "Iâ€™m working on it." || message === "I'm working on it.") {
    message = pickLanguageVariant("acknowledgements.directWorking", "Let me think for a minute.");
  }
  if (!message) {
    return;
  }
  renderPassivePayload("Acknowledged", message);
  presentPayloadSpeech(message, {});
}
Object.assign(observerApp, {
  stopPayloadSpeech,
  chooseVoice,
  presentPayloadSpeech,
  speakAcknowledgement,
  speakWakeAcknowledgement,
  queueAcknowledgement
});

})();