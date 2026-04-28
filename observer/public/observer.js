var observerApp = window.ObserverApp || (window.ObserverApp = {});
const {
  activateTab,
  activateBrainSubtab,
  activateNovaSubtab,
  activateSecretsSubtab,
  activatePluginsSubtab,
  activateCapabilitiesSubtab,
  activateSystemSubtab,
  activateQueueSubtab,
  applyTabIcons,
  dispatchNextTask,
  enqueueTaskFromPrompt,
  enqueueUpdate,
  escapeHtml,
  formatCronObservation,
  formatDateTime,
  formatDurationMs,
  formatEntityRef,
  loadCronJobs,
  loadFile,
  loadSecretsCatalog,
  loadBrainConfig,
  loadNovaConfig,
  loadPluginManagerPanel,
  installUploadedPluginPackage,
  loadPluginPermissionRules,
  savePluginPermissionRules,
  loadPluginTaskLifecycleOutput,
  waitForPluginTaskLifecycleTask,
  createPluginLifecycleTask,
  stopPluginLifecycleTask,
  answerPluginLifecycleTask,
  loadPluginSessionMemoryState,
  capturePluginSessionMemoryTask,
  loadPluginCronHardeningStatus,
  loadTaskReshapeIssues,
  loadRegressionSuites,
  loadToolConfig,
  loadPanelOpenPreference,
  loadPanelFullscreenPreference,
  loadStateInspector,
  loadRuntimeOptions,
  loadTaskFiles,
  loadTaskQueue,
  loadTree,
  pollCronEvents,
  pollTaskEvents,
  pickLanguageVariant: pickLanguageVariantFromApp,
  queueAcknowledgement,
  readFileAsBase64,
  refreshStatus,
  resetToSimpleProjectState,
  replayWaitingQuestionThroughAvatar,
  saveAccessSettings,
  saveToolConfig,
  saveNovaConfig,
  renderAttachmentList,
  renderHistory,
  renderPayloads,
  reportTaskEvent,
  refreshRegressionCommandUi,
  runRegressionSuites,
  setPanelOpen,
  setPanelFullscreen,
  setQueuePaused,
  showQueuedUpdate,
  speakAcknowledgement,
  stopPayloadSpeech,
  triagePrompt,
  triagePromptLocally,
  updateAccessSummary,
  updateRunButtonState,
  addBrainEndpointDraft,
  addCustomBrainDraft,
  saveBrainConfig
} = observerApp;

function isWorkerLikeBrain(brain = {}) {
  const id = String(brain?.id || "").trim().toLowerCase();
  const label = String(brain?.label || "").trim().toLowerCase();
  const kind = String(brain?.kind || "").trim().toLowerCase();
  return id.includes("worker") || label.includes("worker") || kind === "worker";
}

function dispatchDirectWorkerHandoff(phase = "started", detail = {}) {
  window.dispatchEvent(new CustomEvent("observer:intake-worker-handoff", {
    detail: {
      phase,
      at: Date.now(),
      ...detail
    }
  }));
}

const startAgentRun = async (messageOverride = "", options = {}) => {
  unlockSpeech();
  const message = String(messageOverride || document.getElementById("msg").value || "").trim();
  const sourceIdentity = options?.sourceIdentity && typeof options.sourceIdentity === "object"
    ? options.sourceIdentity
    : null;
  if (runInFlight) {
    if (message) {
      pendingSubmissionPrompts.push(sourceIdentity ? { text: message, sourceIdentity } : message);
      if (pendingSubmissionPrompts.length > MAX_PENDING_SUBMISSION_PROMPTS) {
        pendingSubmissionPrompts.splice(0, pendingSubmissionPrompts.length - MAX_PENDING_SUBMISSION_PROMPTS);
      }
      hintEl.textContent = `Queued another request locally. ${pendingSubmissionPrompts.length} waiting.`;
    }
    return;
  }
  const sessionId = document.getElementById("sessionId").value;
  let brain = getIntakeBrain();
  let spokeInitialAck = false;
  if (!message) {
    throw new Error("message is required");
  }
  const effectiveMessage = message;
  document.getElementById("msg").value = effectiveMessage;
  runInFlight = true;
  updateRunButtonState();
  stopPayloadSpeech();
  runStatusEl.textContent = "Running";
  runBrainEl.textContent = brain?.label || "-";
  runModelEl.textContent = "-";
  runDurationEl.textContent = "-";
  payloadsEl.innerHTML = `<div class="payload">Waiting for agent response...</div>`;
  resultEl.textContent = "";
  hintEl.textContent = "Agent run in progress.";

  let attachments = [];
  let directWorkerHandoffActive = false;

  try {
    const shouldRoute = queueHandoffEl.checked && ["bitnet", "worker"].includes(brain?.id || "");
    if (shouldRoute) {
      const localTriage = triagePromptLocally({ message: effectiveMessage, brain });
      if (localTriage.predictedMode === "queue" && localTriage.ack) {
        queueAcknowledgement(pickLanguageVariantFromApp(
          "acknowledgements.queueChecking",
          localTriage.ack
        ));
        spokeInitialAck = true;
        hintEl.textContent = "Triage is checking whether this should be escalated.";
      } else if (!spokeInitialAck) {
        const earlyAck = pickLanguageVariantFromApp(
          "acknowledgements.queueChecking",
          "Let me get back to you on that one."
        );
        queueAcknowledgement(earlyAck);
        spokeInitialAck = true;
        hintEl.textContent = "CPU intake is checking whether this should be escalated.";
      } else if (localTriage.predictedMode === "direct-fast") {
        const fastBrain = (runtimeOptions.brains || []).find((entry) => entry.id === "fast");
        if (fastBrain) {
          brain = fastBrain;
          runBrainEl.textContent = fastBrain.label;
        }
      } else if (brain?.id === "main" && localTriage.complexity <= 4) {
        const fastBrain = (runtimeOptions.brains || []).find((entry) => entry.id === "fast");
        if (fastBrain) {
          brain = fastBrain;
          runBrainEl.textContent = fastBrain.label;
        }
      }
      const triage = await triagePrompt({ message: effectiveMessage, brain, sourceIdentity });
      const triageMessage = String(triage.effectiveMessage || effectiveMessage).trim() || effectiveMessage;
      if (triage.mode === "observer-native" && triage.nativeResponse) {
        const native = triage.nativeResponse;
        runStatusEl.textContent = "ok";
        runBrainEl.textContent = "Observer";
        runModelEl.textContent = "native";
        runDurationEl.textContent = "-";
        payloadsEl.innerHTML = `<div class="payload">${escapeHtml(native.text || "Done.")}</div>`;
        resultEl.textContent = JSON.stringify({ ok: true, native, triage }, null, 2);
        hintEl.textContent = native.detail || native.text || "Observer handled the request directly.";
        enqueueUpdate({
          source: "manual",
          title: native.title || "Observer result",
          displayText: native.text || "Done.",
          spokenText: native.text || "",
          rawText: native.text || "",
          status: "ok",
          brainLabel: "Observer",
          model: "native"
        }, { priority: true });
        document.getElementById("msg").value = "";
        selectedAttachments = [];
        fileInputEl.value = "";
        renderAttachmentList();
        return;
      }
      if (triage.action === "reply_only") {
        const directText = triage.replyText || "Done.";
        runStatusEl.textContent = "ok";
        runBrainEl.textContent = triage.selectedBrainLabel || brain?.label || "CPU Intake";
        runModelEl.textContent = triage.selectedBrainModel || "-";
        runDurationEl.textContent = "-";
        payloadsEl.innerHTML = `<div class="payload">${escapeHtml(directText)}</div>`;
        resultEl.textContent = JSON.stringify({ ok: true, triage }, null, 2);
        hintEl.textContent = triage.intakeReason || "CPU intake handled the request directly.";
        enqueueUpdate({
          source: "manual",
          title: "CPU intake result",
          displayText: directText,
          spokenText: directText,
          rawText: directText,
          status: "ok",
          brainLabel: triage.selectedBrainLabel || brain?.label || "CPU Intake",
          model: triage.selectedBrainModel || ""
        }, { priority: true });
        document.getElementById("msg").value = "";
        selectedAttachments = [];
        fileInputEl.value = "";
        renderAttachmentList();
        return;
      }
      attachments = [];
      for (const file of selectedAttachments) {
        attachments.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          contentBase64: await readFileAsBase64(file)
        });
      }
      const task = await enqueueTaskFromPrompt({
        message: triageMessage,
        sessionId,
        brain,
        attachments,
        requestedBrainId: triage.selectedBrainId,
        plannedTasks: triage.plannedTasks || [],
        sourceIdentity
      });
      const taskRef = task.codename || formatEntityRef("task", task.id || "unknown");
      const destinationLabel = triage.selectedBrainLabel || task.requestedBrainLabel || task.requestedBrainId;
      const queueTitle = triage.mode === "queue" ? "Getting it ready" : "Getting it ready";
      const queueDisplayText = triage.replyText || (triage.mode === "queue"
        ? pickLanguageVariantFromApp("acknowledgements.queueEscalated", `Let me get back to you on that one.\n\nI'll hand {{taskRef}} to {{destinationLabel}} for a closer look.`, { taskRef, destinationLabel })
        : pickLanguageVariantFromApp("acknowledgements.queueReady", `Let me get back to you on that one.\n\nI've queued {{taskRef}} for {{destinationLabel}}.`, { taskRef, destinationLabel }));
      const queueSpokenText = queueDisplayText.replace(/\n+/g, " ");
      runStatusEl.textContent = "queued";
      runBrainEl.textContent = `${brain?.label || "Queue intake"} -> ${destinationLabel}`;
      runModelEl.textContent = "task queue";
      runDurationEl.textContent = "-";
      payloadsEl.innerHTML = `<div class="payload"><strong>${escapeHtml(queueTitle)}</strong>\n\n${escapeHtml(queueDisplayText)}</div>`;
      resultEl.textContent = JSON.stringify({ ok: true, task, triage }, null, 2);
      hintEl.textContent = `Queued ${taskRef} for ${destinationLabel} (${triage.reason}).`;
      enqueueUpdate({
        source: "task",
        title: queueTitle,
        displayText: queueDisplayText,
        spokenText: queueSpokenText,
        status: task.status || "queued",
        brainLabel: destinationLabel || "worker",
        model: "task queue"
      }, { priority: true });
      await loadTaskQueue();
      document.getElementById("msg").value = "";
      selectedAttachments = [];
      fileInputEl.value = "";
      renderAttachmentList();
      return;
    }

    if (!spokeInitialAck) {
      queueAcknowledgement(pickLanguageVariantFromApp(
        "acknowledgements.directWorking",
        "Let me think for a minute."
      ));
    }

    attachments = [];
    for (const file of selectedAttachments) {
      attachments.push({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        contentBase64: await readFileAsBase64(file)
      });
    }

    const adminFetch = typeof observerApp.adminFetch === "function"
      ? observerApp.adminFetch.bind(observerApp)
      : fetch;
    directWorkerHandoffActive = isWorkerLikeBrain(brain);
    if (directWorkerHandoffActive) {
      dispatchDirectWorkerHandoff("started", {
        message: effectiveMessage,
        brainId: brain?.id || "worker",
        brainLabel: brain?.label || "Worker",
        source: "direct-run"
      });
    }
    const r = await adminFetch("/api/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: effectiveMessage,
        sessionId,
        brainId: brain?.id || "main",
        preset: DEFAULT_PRESET,
        internetEnabled: true,
        forceToolUse: forceToolUseEl.checked,
        requireWorkerPreflight: requireWorkerPreflightEl.checked,
        attachments,
        sourceIdentity
      })
    });

    const j = await r.json();
    const parsed = j.parsed;
    const result = parsed?.result || parsed;
    const meta = result?.meta || {};
    const agentMeta = meta?.agentMeta || {};
    const responseContent = renderPayloads(result?.payloads);
    const hasTextResponse = Boolean((responseContent.displayText || "").trim());
    const artifactSummary = Array.isArray(j.outputFiles) && j.outputFiles.length
      ? `No text response. Generated files: ${j.outputFiles.map((file) => file.path || file.name).join(", ")}`
      : "";

    runStatusEl.textContent = parsed?.status || (j.ok ? "ok" : "error");
    runBrainEl.textContent = j.brain?.label || brain?.label || "-";
    runModelEl.textContent = j.brain?.model || agentMeta?.model || "-";
    runDurationEl.textContent = meta?.durationMs ? `${meta.durationMs} ms` : "-";
    resultEl.textContent = JSON.stringify(j, null, 2);
    hintEl.textContent = j.ok
      ? `Run completed with ${j.brain?.label || brain?.label || "unknown brain"} on ${j.network || "unknown network"} and attachments: ${(j.attachments || []).map((file) => file.name).join(", ") || "none"}.`
      : (j.stderr || j.error || "Run failed.");
    enqueueUpdate({
      source: "manual",
      title: "Manual run result",
      displayText: responseContent.displayText || artifactSummary || (j.ok ? "Run completed without payload text." : (j.stderr || j.error || "Run failed.")),
      spokenText: responseContent.spokenText || (artifactSummary ? `[nova:emotion=celebrate] ${artifactSummary}` : ""),
      rawText: responseContent.rawText || "",
      status: parsed?.status || (j.ok ? "ok" : "error"),
      brainLabel: j.brain?.label || brain?.label || "",
      model: j.brain?.model || agentMeta?.model || ""
    }, { priority: true });
    if (j.ok && !hasTextResponse) {
      runStatusEl.textContent = "no_text";
      hintEl.textContent = artifactSummary || `${brain?.label || "Agent"} finished without returning payload text. Consider queueing this task to a stronger brain.`;
    }
    if (j.ok) {
      document.getElementById("msg").value = "";
      selectedAttachments = [];
      fileInputEl.value = "";
      renderAttachmentList();
    }
    if (directWorkerHandoffActive) {
      dispatchDirectWorkerHandoff("completed", {
        ok: j.ok === true,
        brainId: j.brain?.id || brain?.id || "worker",
        brainLabel: j.brain?.label || brain?.label || "Worker",
        source: "direct-run"
      });
      directWorkerHandoffActive = false;
    }
  } catch (error) {
    if (directWorkerHandoffActive) {
      dispatchDirectWorkerHandoff("failed", {
        error: String(error?.message || error || "request failed"),
        brainId: brain?.id || "worker",
        brainLabel: brain?.label || "Worker",
        source: "direct-run"
      });
      directWorkerHandoffActive = false;
    }
    runStatusEl.textContent = "error";
    payloadsEl.innerHTML = `<div class="payload">Request failed: ${escapeHtml(error.message)}</div>`;
    resultEl.textContent = String(error);
    hintEl.textContent = "Interface request failed before a response was returned.";
  } finally {
    if (directWorkerHandoffActive) {
      dispatchDirectWorkerHandoff("completed", {
        brainId: brain?.id || "worker",
        brainLabel: brain?.label || "Worker",
        source: "direct-run"
      });
    }
    runInFlight = false;
    updateRunButtonState();
    refreshStatus();
    showQueuedUpdate();
    flushPendingSubmissionPrompt();
  }
};

runBtn.onclick = () => {
  startAgentRun().catch((error) => {
    payloadsEl.innerHTML = `<div class="payload">Request failed: ${escapeHtml(error.message)}</div>`;
    resultEl.textContent = String(error);
    hintEl.textContent = "Interface request failed before a response was returned.";
  });
};

clearBtn.onclick = () => {
  stopPayloadSpeech();
  updateQueue = [];
  queueDisplayActive = false;
  payloadsEl.innerHTML = `<div class="payload">Cleared.</div>`;
  resultEl.textContent = "";
  selectedAttachments = [];
  fileInputEl.value = "";
  renderAttachmentList();
  runStatusEl.textContent = "Idle";
  runBrainEl.textContent = "Queued via triage";
  runModelEl.textContent = "-";
  runDurationEl.textContent = "-";
  hintEl.textContent = "Cleared local run output.";
};

voiceToggleBtn.onclick = () => {
  unlockSpeech();
  if (!speechRecognitionSupported || !speechRecognition) {
    updateVoiceUi();
    return;
  }
  if (voiceListeningEnabled) {
    voiceListeningEnabled = false;
    voiceStopRequested = true;
    if (typeof clearPendingVoiceQuestionWindow === "function") {
      clearPendingVoiceQuestionWindow();
    }
    if (voiceRestartTimer) {
      window.clearTimeout(voiceRestartTimer);
      voiceRestartTimer = null;
    }
    resetVoiceCapture();
    try {
      speechRecognition.stop();
    } catch {
      // ignore stop races
    }
    updateVoiceUi();
    return;
  }
  voiceListeningEnabled = true;
  voiceStopRequested = false;
  resetVoiceCapture();
  updateVoiceUi();
  try {
    speechRecognition.start();
  } catch {
    scheduleVoiceRestart(400);
  }
};

fileInputEl.onchange = () => {
  selectedAttachments = Array.from(fileInputEl.files || []);
  renderAttachmentList();
};

forceToolUseEl.onchange = () => {
  updateAccessSummary();
  saveAccessSettings();
};
requireWorkerPreflightEl.onchange = () => {
  updateAccessSummary();
  saveAccessSettings();
};
queueHandoffEl.onchange = () => {
  updateAccessSummary();
  saveAccessSettings();
};

cronAddBtn.onclick = async () => {
  cronAddBtn.disabled = true;
  cronHintEl.textContent = "Creating scheduled job...";
  try {
    const r = await fetch("/api/cron/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: cronNameEl.value,
        every: cronEveryEl.value,
        message: cronMessageEl.value,
        brainId: cronBrainSelectEl.value
      })
    });
    const j = await r.json();
    if (!j.ok) {
      throw new Error(j.error || "Job creation failed");
    }
    const staggerText = j.staggered?.nextRunAtMs
      ? ` Next run: ${formatDateTime(j.staggered.nextRunAtMs)}${j.staggered.applied ? " (auto-staggered)" : ""}.`
      : "";
    cronHintEl.textContent = `Created job "${j.job.name}" with ${j.brain.label}.${staggerText}`;
    await loadCronJobs();
  } catch (error) {
    cronHintEl.textContent = error.message;
  } finally {
    cronAddBtn.disabled = false;
  }
};

pauseQueueBtn.onclick = async () => {
  await setQueuePaused(true);
};

resumeQueueBtn.onclick = async () => {
  await setQueuePaused(false);
};

refreshRegressionBtn.onclick = loadRegressionSuites;
runAllRegressionsBtn.onclick = async () => {
  runAllRegressionsBtn.disabled = true;
  try {
    await runRegressionSuites("all");
  } finally {
    runAllRegressionsBtn.disabled = false;
  }
};
if (regressionCommandSuiteSelectEl) {
  regressionCommandSuiteSelectEl.onchange = () => {
    refreshRegressionCommandUi();
  };
}
if (copyRegressionCommandBtn) {
  copyRegressionCommandBtn.onclick = async () => {
    const commandLine = String(regressionCommandLineEl?.textContent || "").trim();
    if (!commandLine) {
      regressionCommandHintEl.textContent = "No regression command is ready yet.";
      return;
    }
    try {
      await navigator.clipboard.writeText(commandLine);
      regressionCommandHintEl.textContent = "Regression command copied to the clipboard.";
    } catch (error) {
      regressionCommandHintEl.textContent = `Copy failed: ${error.message}`;
    }
  };
}

refreshBtn.onclick = refreshStatus;
resetTaskReshapeIssuesBtn.onclick = async () => {
  resetTaskReshapeIssuesBtn.disabled = true;
  taskReshapeIssuesSummaryEl.textContent = "Resetting recurring issues...";
  try {
    const r = await fetch("/api/tasks/reshape-issues/reset", {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "reset failed");
    }
    await loadTaskReshapeIssues();
    hintEl.textContent = `Recurring issues reset. Cleared ${Number(j.clearedIssueCount || 0)} tracked issue${Number(j.clearedIssueCount || 0) === 1 ? "" : "s"}.`;
  } catch (error) {
    taskReshapeIssuesSummaryEl.textContent = `Issue reset failed: ${error.message}`;
  } finally {
    resetTaskReshapeIssuesBtn.disabled = false;
  }
};
resetEventHistoryBtn.onclick = () => {
  const now = Date.now();
  latestCronEventTs = now;
  latestTaskEventTs = now;
  saveEventCursor(CRON_CURSOR_KEY, now);
  saveEventCursor(TASK_CURSOR_KEY, now);
  seenTaskEventKeys.clear();
  historyEntries = [];
  renderHistory();
  updateQueue = [];
  queueDisplayActive = false;
  hintEl.textContent = "Activity feed reset. Only new job and task updates will be shown from now on.";
};
refreshQueueBtn.onclick = loadTaskQueue;
questionTimeBtn.onclick = () => {
  replayWaitingQuestionThroughAvatar();
};
dispatchNextBtn.onclick = dispatchNextTask;
if (reloadFilesBtn) {
  reloadFilesBtn.onclick = () => loadStateInspector({ preserveSelection: true });
}
if (resetSimpleStateBtn) {
  resetSimpleStateBtn.onclick = resetToSimpleProjectState;
}
if (scopeSelect) {
  scopeSelect.onchange = () => loadStateInspector({ preserveSelection: true });
}
refreshBrainsBtn.onclick = loadBrainConfig;
refreshSecretsBtn.onclick = loadSecretsCatalog;
saveBrainsBtn.onclick = saveBrainConfig;
refreshNovaBtn.onclick = loadNovaConfig;
saveNovaBtn.onclick = saveNovaConfig;
refreshToolsBtn.onclick = loadToolConfig;
saveToolsBtn.onclick = saveToolConfig;
refreshPluginsBtn.onclick = loadPluginManagerPanel;
if (installPluginUploadBtn) {
  installPluginUploadBtn.onclick = installUploadedPluginPackage;
}
if (refreshPluginPermissionsBtn) {
  refreshPluginPermissionsBtn.onclick = () => loadPluginPermissionRules();
}
if (savePluginPermissionsBtn) {
  savePluginPermissionsBtn.onclick = savePluginPermissionRules;
}
if (refreshPluginTaskLifecycleBtn) {
  refreshPluginTaskLifecycleBtn.onclick = loadPluginTaskLifecycleOutput;
}
if (pluginTaskLifecycleCreateBtn) {
  pluginTaskLifecycleCreateBtn.onclick = createPluginLifecycleTask;
}
if (pluginTaskLifecycleOutputBtn) {
  pluginTaskLifecycleOutputBtn.onclick = loadPluginTaskLifecycleOutput;
}
if (pluginTaskLifecycleWaitBtn) {
  pluginTaskLifecycleWaitBtn.onclick = waitForPluginTaskLifecycleTask;
}
if (pluginTaskLifecycleStopBtn) {
  pluginTaskLifecycleStopBtn.onclick = stopPluginLifecycleTask;
}
if (pluginTaskLifecycleAnswerBtn) {
  pluginTaskLifecycleAnswerBtn.onclick = answerPluginLifecycleTask;
}
if (refreshPluginSessionMemoryBtn) {
  refreshPluginSessionMemoryBtn.onclick = () => loadPluginSessionMemoryState();
}
if (capturePluginSessionMemoryBtn) {
  capturePluginSessionMemoryBtn.onclick = capturePluginSessionMemoryTask;
}
if (refreshPluginCronBtn) {
  refreshPluginCronBtn.onclick = () => loadPluginCronHardeningStatus();
}
addBrainEndpointBtn.onclick = addBrainEndpointDraft;
addCustomBrainBtn.onclick = addCustomBrainDraft;
setPanelOpen(loadPanelOpenPreference());
setPanelFullscreen(loadPanelFullscreenPreference());
applyTabIcons();

panelToggleBtn.onclick = () => {
  setPanelOpen(!panelDrawerEl.classList.contains("open"));
};

panelCloseBtn.onclick = () => {
  setPanelFullscreen(!panelDrawerEl.classList.contains("fullscreen"));
};

tabButtons.forEach((button) => {
  button.onclick = () => activateTab(button.dataset.tabTarget);
});
novaSubtabButtons.forEach((button) => {
  button.onclick = () => {
    activateNovaSubtab(button.dataset.novaSubtabTarget);
  };
});
brainSubtabButtons.forEach((button) => {
  button.onclick = () => activateBrainSubtab(button.dataset.brainSubtabTarget);
});
secretsSubtabButtons.forEach((button) => {
  button.onclick = () => activateSecretsSubtab(button.dataset.secretsSubtabTarget);
});
pluginsSubtabButtons.forEach((button) => {
  button.onclick = () => activatePluginsSubtab(button.dataset.pluginsSubtabTarget);
});
capabilitiesSubtabButtons.forEach((button) => {
  button.onclick = () => activateCapabilitiesSubtab(button.dataset.capabilitiesSubtabTarget);
});
systemSubtabButtons.forEach((button) => {
  button.onclick = () => activateSystemSubtab(button.dataset.systemSubtabTarget);
});
queueSubtabButtons.forEach((button) => {
  button.onclick = () => activateQueueSubtab(button.dataset.queueSubtabTarget);
});
activateNovaSubtab(activeNovaSubtabId || "novaIdentityPanel");
activateBrainSubtab("brainsStatusPanel");
activateSecretsSubtab(activeSecretsSubtabId || "secretsOverviewPanel");
activatePluginsSubtab(activePluginsSubtabId || "pluginsInventoryPanel");
activateCapabilitiesSubtab(activeCapabilitiesSubtabId || "capabilitiesToolsPanel");
activateSystemSubtab(activeSystemSubtabId || "systemGatewayPanel");
activateQueueSubtab(activeQueueSubtabId || "taskQueueQueuedPanel");
initVoiceRecognition();
updateAccessSummary();
refreshStatus();
loadRuntimeOptions();
loadNovaConfig();
loadBrainConfig();
loadSecretsCatalog();
loadToolConfig();
loadPluginManagerPanel();
loadTaskQueue();
loadCronJobs();
refreshRegressionCommandUi();
loadRegressionSuites();
if (scopeSelect) {
  loadStateInspector({ preserveSelection: true });
}
pollCronEvents();
pollTaskEvents();
renderAttachmentList();
updateRunButtonState();
setInterval(refreshStatus, 15000);
setInterval(pollCronEvents, 15000);
setInterval(pollTaskEvents, 15000);
