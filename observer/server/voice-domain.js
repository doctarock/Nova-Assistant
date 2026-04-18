export function createVoiceDomain(options = {}) {
  const {
    compactHookText = (value = "") => String(value || ""),
    createInitialVoicePatternStore = () => ({ profiles: [] }),
    fs = null,
    loadObserverConfig = async () => {},
    normalizeVoiceTrustProfile = (entry = {}) => entry,
    runHook = async () => {},
    sanitizeHookToken = (value = "") => String(value || "").trim().toLowerCase(),
    saveObserverConfig = async () => {},
    voicePatternStorePath = "",
    writeVolumeText = async () => {},
    getVoicePatternStore = () => createInitialVoicePatternStore(),
    setVoicePatternStore = () => {}
  } = options;

  async function loadVoicePatternStore() {
    try {
      const raw = await fs.readFile(voicePatternStorePath, "utf8");
      const parsed = JSON.parse(raw);
      setVoicePatternStore({
        profiles: Array.isArray(parsed?.profiles)
          ? parsed.profiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
          : []
      });
    } catch {
      const observerConfig = await loadObserverConfig();
      const migratedProfiles = Array.isArray(observerConfig?.app?.trust?.voiceProfiles) && observerConfig.app.trust.voiceProfiles.length
        ? observerConfig.app.trust.voiceProfiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
        : (Array.isArray(observerConfig?.app?.trust?.records)
          ? observerConfig.app.trust.records
            .map((entry, index) => normalizeVoiceTrustProfile(entry, index))
            .filter((entry) => entry.signature.length)
          : []);
      setVoicePatternStore({ profiles: migratedProfiles });
      if (migratedProfiles.length) {
        await saveVoicePatternStore();
        if (observerConfig?.app?.trust) {
          observerConfig.app.trust = {
            ...observerConfig.app.trust,
            voiceProfiles: []
          };
          await saveObserverConfig();
        }
      }
    }
  }

  async function saveVoicePatternStore() {
    const current = getVoicePatternStore();
    const nextStore = {
      profiles: Array.isArray(current?.profiles)
        ? current.profiles.map((entry, index) => normalizeVoiceTrustProfile(entry, index)).filter((entry) => entry.label || entry.signature.length)
        : []
    };
    setVoicePatternStore(nextStore);
    await writeVolumeText(voicePatternStorePath, `${JSON.stringify(nextStore, null, 2)}\n`);
  }

  function stripNovaEmotionTags(text = "") {
    return String(text || "")
      .replace(/\[nova:(emotion|animation)=[^\]]+\]/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function inferNovaEmotionForText(text = "", context = "reply") {
    const clean = stripNovaEmotionTags(text).toLowerCase();
    const normalizedContext = String(context || "reply").trim().toLowerCase();
    if (!clean) return normalizedContext === "question" ? "shrug" : "calm";
    if (normalizedContext === "question") return "shrug";
    if (normalizedContext === "failure") return /\b(sorry|apolog|regret)\b/.test(clean) ? "hurt" : "angry";
    if (normalizedContext === "success" || normalizedContext === "output") return "celebrate";
    if (/\b(what did you mean|can you clarify|which one|what should i|how should i|could you confirm|do you want)\b/.test(clean)) return "shrug";
    if (/\b(done|finished|complete|completed|wrapped up|ready|created|generated|saved|sent to output|exported|packaged)\b/.test(clean)) return "celebrate";
    if (/\b(failed|error|problem|issue|couldn'?t|cannot|can'?t|blocked|timeout|timed out)\b/.test(clean)) return "angry";
    if (/\b(think|consider|reviewed|checked|looked|found|explained|because)\b/.test(clean)) return "reflect";
    if (/\b(yes|exactly|agreed|correct|right)\b/.test(clean)) return "agree";
    return "explain";
  }

  function annotateNovaSpeechText(text = "", context = "reply") {
    const raw = String(text || "").trim();
    if (!raw || /\[nova:(emotion|animation)=/i.test(raw)) {
      if (raw) {
        void runHook("subsystem:voice:response-annotated", {
          at: Date.now(),
          context: sanitizeHookToken(context) || "reply",
          reusedExistingTag: true,
          emotion: "",
          rawPreview: compactHookText(raw, 220),
          annotatedPreview: compactHookText(raw, 220)
        });
      }
      return raw;
    }
    const emotion = inferNovaEmotionForText(raw, context);
    const annotated = emotion ? `[nova:emotion=${emotion}] ${raw}` : raw;
    void runHook("subsystem:voice:response-annotated", {
      at: Date.now(),
      context: sanitizeHookToken(context) || "reply",
      reusedExistingTag: false,
      emotion: sanitizeHookToken(emotion),
      rawPreview: compactHookText(raw, 220),
      annotatedPreview: compactHookText(annotated, 220)
    });
    return annotated;
  }

  return {
    annotateNovaSpeechText,
    inferNovaEmotionForText,
    loadVoicePatternStore,
    saveVoicePatternStore,
    stripNovaEmotionTags
  };
}
