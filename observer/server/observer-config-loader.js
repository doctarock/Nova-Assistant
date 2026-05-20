export function createObserverConfigLoader({
  configPath,
  defaultQdrantCollection,
  defaultQdrantUrl,
  defaultAppPropSlots,
  defaultAppRoomTextures,
  fs,
  getObserverConfig,
  getObserverLanguage,
  getObserverLexicon,
  getOpportunityScanState,
  getProjectConfig,
  languageConfigPath,
  lexiconConfigPath,
  localOllamaBaseUrl,
  migrateLegacyMailPassword,
  migrateLegacyQdrantApiKey,
  normalizeAppTrustConfig,
  normalizeOllamaBaseUrl,
  normalizeProjectConfigInput,
  normalizePropScale,
  normalizeReactionPathsByModel,
  normalizeStylizationEffectPreset,
  normalizeStylizationFilterPreset,
  opportunityScanStatePath,
  saveObserverConfig,
  setObserverConfig,
  setObserverLanguage,
  setObserverLexicon,
  setOpportunityScanState,
  writeVolumeText
} = {}) {
  function normalizeOpportunityScanState(parsed = {}) {
    return {
      lastScanAt: Number(parsed?.lastScanAt || 0),
      lastCreatedAt: Number(parsed?.lastCreatedAt || 0),
      lastCleanupAt: Number(parsed?.lastCleanupAt || 0),
      nextMode: String(parsed?.nextMode || "scan").trim() === "cleanup" ? "cleanup" : "scan",
      recentKeys: parsed?.recentKeys && typeof parsed.recentKeys === "object" ? parsed.recentKeys : {},
      markdownOffsets: parsed?.markdownOffsets && typeof parsed.markdownOffsets === "object" ? parsed.markdownOffsets : {},
      projectRotation: {
        recentImports: parsed?.projectRotation?.recentImports && typeof parsed.projectRotation.recentImports === "object"
          ? parsed.projectRotation.recentImports
          : {},
        backups: parsed?.projectRotation?.backups && typeof parsed.projectRotation.backups === "object"
          ? parsed.projectRotation.backups
          : {}
      }
    };
  }

  async function loadObserverConfig() {
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const retrievalApiKeyHandle = await migrateLegacyQdrantApiKey(parsed?.retrieval);
      const mailAgents = {};
      let migratedMailPasswords = false;
      for (const [id, agent] of Object.entries(parsed?.mail?.agents || {})) {
        const passwordHandle = await migrateLegacyMailPassword(id, agent?.password, agent?.passwordHandle);
        if (String(agent?.password || "").trim()) {
          migratedMailPasswords = true;
        }
        mailAgents[String(id)] = {
          id: String(id),
          label: String(agent?.label || id),
          aliases: Array.isArray(agent?.aliases) ? agent.aliases.map((value) => String(value)).filter(Boolean) : [],
          email: String(agent?.email || ""),
          user: String(agent?.user || agent?.email || ""),
          password: "",
          passwordHandle
        };
      }
      const configuredEndpoints = parsed?.brains?.endpoints && typeof parsed.brains.endpoints === "object"
        ? Object.fromEntries(
            Object.entries(parsed.brains.endpoints).map(([id, entry]) => [String(id), {
              label: String(entry?.label || id),
              provider: String(entry?.provider || "ollama").trim().toLowerCase() || "ollama",
              baseUrl: String(entry?.provider || "ollama").trim().toLowerCase() === "ollama"
                ? normalizeOllamaBaseUrl(entry?.baseUrl || "")
                : normalizeOllamaBaseUrl(entry?.baseUrl || "https://api.openai.com/v1"),
              apiKeyEnv: String(entry?.apiKeyEnv || "").trim(),
              apiKeyHandle: String(entry?.apiKeyHandle || "").trim()
            }])
          )
        : {
            local: {
              label: "Local Ollama",
              provider: "ollama",
              baseUrl: localOllamaBaseUrl
            }
          };
      setObserverConfig({
        app: {
          botName: String(parsed?.app?.botName || "Agent"),
          avatarModelPath: String(parsed?.app?.avatarModelPath || "/assets/characters/Nova.glb"),
          backgroundImagePath: String(parsed?.app?.backgroundImagePath || ""),
          stylizationFilterPreset: normalizeStylizationFilterPreset(
            parsed?.app?.stylizationFilterPreset ?? parsed?.app?.stylizationPreset,
            "none"
          ),
          stylizationEffectPreset: normalizeStylizationEffectPreset(
            parsed?.app?.stylizationEffectPreset ?? parsed?.app?.stylizationPreset,
            "none"
          ),
          reactionPathsByModel: normalizeReactionPathsByModel(parsed?.app?.reactionPathsByModel),
          roomTextures: {
            ...defaultAppRoomTextures(),
            ...(parsed?.app?.roomTextures && typeof parsed.app.roomTextures === "object" ? Object.fromEntries(
              Object.entries(parsed.app.roomTextures).map(([key, value]) => [String(key), String(value || "")])
            ) : {})
          },
          propSlots: {
            ...defaultAppPropSlots(),
            ...(parsed?.app?.propSlots && typeof parsed.app.propSlots === "object" ? Object.fromEntries(
              Object.entries(parsed.app.propSlots).map(([key, value]) => {
                if (value && typeof value === "object") {
                  return [String(key), {
                    model: String(value.model || ""),
                    scale: normalizePropScale(value.scale, 1)
                  }];
                }
                return [String(key), {
                  model: String(value || ""),
                  scale: 1
                }];
              })
            ) : {})
          },
          voicePreferences: Array.isArray(parsed?.app?.voicePreferences)
            ? parsed.app.voicePreferences.map((value) => String(value)).filter(Boolean)
            : [],
          quietMode: parsed?.app?.quietMode === true,
          trust: normalizeAppTrustConfig(parsed?.app?.trust)
        },
        defaults: {
          internetEnabled: parsed?.defaults?.internetEnabled !== false,
          mountIds: [],
          intakeBrainId: String(parsed?.defaults?.intakeBrainId || "bitnet")
        },
        brains: {
          enabledIds: Array.isArray(parsed?.brains?.enabledIds)
            ? parsed.brains.enabledIds.map((value) => String(value)).filter(Boolean)
            : ["bitnet", "worker"],
          builtIn: Array.isArray(parsed?.brains?.builtIn)
            ? parsed.brains.builtIn
            : [],
          endpoints: configuredEndpoints,
          assignments: parsed?.brains?.assignments && typeof parsed.brains.assignments === "object"
            ? Object.fromEntries(Object.entries(parsed.brains.assignments).map(([id, value]) => [String(id), String(value)]))
            : {
                bitnet: "local",
                worker: "local",
                helper: "local"
              },
          custom: Array.isArray(parsed?.brains?.custom) ? parsed.brains.custom : []
        },
        queue: {
          remoteParallel: parsed?.queue?.remoteParallel !== false,
          escalationEnabled: parsed?.queue?.escalationEnabled !== false,
          paused: parsed?.queue?.paused === true
        },
        projects: normalizeProjectConfigInput(parsed?.projects),
        routing: {
          enabled: parsed?.routing?.enabled === true,
          remoteTriageBrainId: String(parsed?.routing?.remoteTriageBrainId || ""),
          specialistMap: {
            code: Array.isArray(parsed?.routing?.specialistMap?.code) ? parsed.routing.specialistMap.code.map((value) => String(value)).filter(Boolean) : [],
            document: Array.isArray(parsed?.routing?.specialistMap?.document) ? parsed.routing.specialistMap.document.map((value) => String(value)).filter(Boolean) : [],
            general: Array.isArray(parsed?.routing?.specialistMap?.general) ? parsed.routing.specialistMap.general.map((value) => String(value)).filter(Boolean) : [],
            background: Array.isArray(parsed?.routing?.specialistMap?.background) ? parsed.routing.specialistMap.background.map((value) => String(value)).filter(Boolean) : [],
            creative: Array.isArray(parsed?.routing?.specialistMap?.creative) ? parsed.routing.specialistMap.creative.map((value) => String(value)).filter(Boolean) : [],
            vision: Array.isArray(parsed?.routing?.specialistMap?.vision) ? parsed.routing.specialistMap.vision.map((value) => String(value)).filter(Boolean) : [],
            retrieval: Array.isArray(parsed?.routing?.specialistMap?.retrieval) ? parsed.routing.specialistMap.retrieval.map((value) => String(value)).filter(Boolean) : [],
            fast_worker: Array.isArray(parsed?.routing?.specialistMap?.fast_worker) ? parsed.routing.specialistMap.fast_worker.map((value) => String(value)).filter(Boolean) : []
          },
          fallbackAttempts: Math.max(0, Math.min(Number(parsed?.routing?.fallbackAttempts || 2), 4))
        },
        networks: {
          internal: parsed?.networks?.internal || "local",
          internet: parsed?.networks?.internet || "internet"
        },
        retrieval: {
          qdrantUrl: String(parsed?.retrieval?.qdrantUrl || defaultQdrantUrl).trim() || defaultQdrantUrl,
          collectionName: String(parsed?.retrieval?.collectionName || defaultQdrantCollection).trim() || defaultQdrantCollection,
          apiKeyHandle: retrievalApiKeyHandle
        },
        mail: {
          enabled: parsed?.mail?.enabled === true,
          activeAgentId: String(parsed?.mail?.activeAgentId || "nova"),
          pollIntervalMs: Math.max(5000, Number(parsed?.mail?.pollIntervalMs || 30000)),
          imap: {
            host: String(parsed?.mail?.imap?.host || ""),
            port: Number(parsed?.mail?.imap?.port || 993),
            secure: parsed?.mail?.imap?.secure !== false
          },
          smtp: {
            host: String(parsed?.mail?.smtp?.host || ""),
            port: Number(parsed?.mail?.smtp?.port || 587),
            secure: parsed?.mail?.smtp?.secure === true,
            requireTLS: parsed?.mail?.smtp?.requireTLS !== false
          },
          agents: mailAgents
        },
        mounts: []
      });
      if (migratedMailPasswords || String(parsed?.retrieval?.apiKey || "").trim()) {
        await saveObserverConfig();
      }
    } catch (error) {
      console.warn(`Failed to load observer config at ${configPath}: ${error.message}`);
    }
  }

  async function loadObserverLanguage() {
    try {
      const raw = await fs.readFile(languageConfigPath, "utf8");
      const parsed = JSON.parse(raw);
      const observerLanguage = getObserverLanguage();
      setObserverLanguage({
        ...observerLanguage,
        ...parsed,
        acknowledgements: {
          ...observerLanguage.acknowledgements,
          ...(parsed?.acknowledgements || {})
        },
        voice: {
          ...observerLanguage.voice,
          ...(parsed?.voice || {})
        },
        taskNarration: {
          ...observerLanguage.taskNarration,
          ...(parsed?.taskNarration || {})
        }
      });
    } catch (error) {
      console.warn(`Failed to load observer language at ${languageConfigPath}: ${error.message}`);
    }
  }

  async function loadObserverLexicon() {
    try {
      const raw = await fs.readFile(lexiconConfigPath, "utf8");
      const parsed = JSON.parse(raw);
      setObserverLexicon({
        ...getObserverLexicon(),
        ...(parsed && typeof parsed === "object" ? parsed : {})
      });
    } catch (error) {
      console.warn(`Failed to load observer lexicon at ${lexiconConfigPath}: ${error.message}`);
    }
  }

  async function loadOpportunityScanState() {
    try {
      const raw = await fs.readFile(opportunityScanStatePath, "utf8");
      setOpportunityScanState(normalizeOpportunityScanState(JSON.parse(raw)));
    } catch {
      setOpportunityScanState(normalizeOpportunityScanState({}));
    }
  }

  async function saveOpportunityScanState() {
    const opportunityScanState = getOpportunityScanState();
    const cutoff = Date.now() - getProjectConfig().opportunityScanRetentionMs;
    const recentKeys = Object.fromEntries(
      Object.entries(opportunityScanState.recentKeys || {})
        .filter(([, at]) => Number(at || 0) >= cutoff)
    );
    const markdownOffsets = Object.fromEntries(
      Object.entries(opportunityScanState.markdownOffsets || {})
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
        .map(([key, value]) => [key, Number(value)])
    );
    const recentImports = Object.fromEntries(
      Object.entries(opportunityScanState.projectRotation?.recentImports || {})
        .filter(([, at]) => Number(at || 0) >= cutoff)
        .map(([key, value]) => [String(key), Number(value)])
    );
    const backups = Object.fromEntries(
      Object.entries(opportunityScanState.projectRotation?.backups || {})
        .filter(([, value]) => value && typeof value === "object")
        .map(([key, value]) => {
          const record = value && typeof value === "object" ? value : {};
          return [String(key), {
            lastBackupAt: Number(record.lastBackupAt || 0),
            projectModifiedAt: Number(record.projectModifiedAt || 0),
            lastTargetPath: String(record.lastTargetPath || "").trim(),
            lastReason: String(record.lastReason || "").trim()
          }];
        })
        .filter(([, value]) => Number(value.lastBackupAt || 0) >= cutoff)
    );
    const nextState = {
      lastScanAt: Number(opportunityScanState.lastScanAt || 0),
      lastCreatedAt: Number(opportunityScanState.lastCreatedAt || 0),
      lastCleanupAt: Number(opportunityScanState.lastCleanupAt || 0),
      nextMode: String(opportunityScanState.nextMode || "scan").trim() === "cleanup" ? "cleanup" : "scan",
      recentKeys,
      markdownOffsets,
      projectRotation: {
        recentImports,
        backups
      }
    };
    setOpportunityScanState(nextState);
    await writeVolumeText(opportunityScanStatePath, `${JSON.stringify(nextState, null, 2)}\n`);
  }

  return {
    loadObserverConfig,
    loadObserverLanguage,
    loadObserverLexicon,
    loadOpportunityScanState,
    saveOpportunityScanState
  };
}
