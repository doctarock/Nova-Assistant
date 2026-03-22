export function createObserverOpportunityScan(context = {}) {
  const {
    AGENT_BRAINS,
    TASK_QUEUE_CLOSED,
    TASK_QUEUE_DONE,
    TASK_QUEUE_INBOX,
    TASK_QUEUE_IN_PROGRESS,
    MAX_TASK_RESHAPE_ATTEMPTS,
    appendDailyAssistantMemory,
    appendQueueMaintenanceReport,
    archiveExpiredCompletedTasks,
    buildDocumentIndexSnapshot,
    buildDocumentOpportunity,
    buildFailureInvestigationTaskMessage,
    buildOpportunityWorkspaceSnapshot,
    buildRetryTaskMeta,
    buildTaskMaintenanceSnapshot,
    canReshapeTask,
    chooseHelperScoutBrains,
    chooseIdleWorkerBrainForSpecialty,
    classifyFailureText,
    closeCompletedInternalPeriodicTasks,
    closeTaskRecord,
    compactTaskText,
    countIdleBackgroundWorkerBrains,
    countIdleHelperBrains,
    createQueuedTask,
    fillWorkspaceProjectsFromRepositories,
    findTaskById,
    findTaskByMaintenanceKey,
    findTaskByOpportunityKey,
    getIdleBackgroundExecutionCapacity,
    getLastInteractiveActivityAt,
    getObserverConfig,
    getProjectConfig,
    getTaskReshapeAttemptCount,
    getTotalBackgroundExecutionCapacity,
    hashRef,
    inferTaskSpecialty,
    isBogusOrMetaOpportunityMessage,
    isRemoteParallelDispatchEnabled,
    listAllTasks,
    listContainerWorkspaceProjects,
    listTasksByFolder,
    markTaskCriticalFailure,
    planTaskMaintenanceActions,
    planWorkspaceOpportunities,
    processWorkspaceProjectForOpportunityScan,
    queueHelperScoutTask,
    recordTaskReshapeReview,
    saveOpportunityScanState,
    writeDailyDocumentBriefing,
    opportunityScanState
  } = context;
async function executeOpportunityScanJob(task) {
  const now = Date.now();
  const projectConfig = getProjectConfig();
  const observerConfig = getObserverConfig();
  const remoteParallel = await isRemoteParallelDispatchEnabled();
  const { queued, inProgress } = await listAllTasks();
  const otherInProgress = inProgress.filter((entry) => entry.id !== task.id);
  const queuedBacklogCount = Array.isArray(queued) ? queued.length : 0;
  const executionCapacity = await getIdleBackgroundExecutionCapacity();
  const idleWorkerBrains = await countIdleBackgroundWorkerBrains();
  const idleHelperBrains = await countIdleHelperBrains();
  const availableWorkSlots = Math.max(1, Math.min(executionCapacity, idleWorkerBrains || executionCapacity));
  const activeLaneCount = new Set(
    otherInProgress
      .map((entry) => String(entry.queueLane || "").trim())
      .filter(Boolean)
  ).size;
  if (now - Number(getLastInteractiveActivityAt() || 0) < projectConfig.opportunityScanIdleMs) {
    const skipText = "Idle scan skipped because the observer was recently active.";
    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-opportunity-scan",
      brain: AGENT_BRAINS[0],
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      parsed: { status: "ok", result: { payloads: [{ text: skipText, mediaUrl: null }], meta: { durationMs: 0 } } },
      stdout: skipText,
      silentInternalSkip: remoteParallel,
      stderr: ""
    };
  }
  if (queuedBacklogCount >= projectConfig.opportunityScanMaxQueuedBacklog) {
    const skipText = `Idle scan skipped because the queue already has ${queuedBacklogCount} queued tasks.`;
    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-opportunity-scan",
      brain: AGENT_BRAINS[0],
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      parsed: { status: "ok", result: { payloads: [{ text: skipText, mediaUrl: null }], meta: { durationMs: 0, queuedBacklogCount } } },
      stdout: skipText,
      silentInternalSkip: remoteParallel,
      stderr: ""
    };
  }
  if (activeLaneCount >= Math.max(1, executionCapacity)) {
    const skipText = "Idle scan skipped because all current worker lanes are already busy.";
    return {
      ok: true,
      code: 0,
      timedOut: false,
      preset: "internal-opportunity-scan",
      brain: AGENT_BRAINS[0],
      network: "local",
      mounts: [],
      attachments: [],
      outputFiles: [],
      parsed: { status: "ok", result: { payloads: [{ text: skipText, mediaUrl: null }], meta: { durationMs: 0, executionCapacity, idleWorkerBrains, activeLaneCount } } },
      stdout: skipText,
      silentInternalSkip: remoteParallel,
      stderr: ""
    };
  }

  const wakeMode = String(opportunityScanState.nextMode || "scan").trim() === "cleanup" ? "cleanup" : "scan";
  const created = [];
  let closedCount = 0;
  let advancedCount = 0;
  let archivedCount = 0;
  let documentScanSummary = null;
  let projectRotationSummary = null;
  let activeProjectSummary = null;
  const reportLines = [];
  if (wakeMode === "scan") {
    documentScanSummary = await buildDocumentIndexSnapshot();
    await writeDailyDocumentBriefing(documentScanSummary);
    if (documentScanSummary.newDocuments.length || documentScanSummary.changedDocuments.length || documentScanSummary.urgentDocuments.length) {
      const documentLines = [
        `Tracked ${documentScanSummary.totalDocuments} document${documentScanSummary.totalDocuments === 1 ? "" : "s"}.`,
        `New: ${documentScanSummary.newDocuments.length}.`,
        `Changed: ${documentScanSummary.changedDocuments.length}.`,
        `Needs attention: ${documentScanSummary.urgentDocuments.length}.`
      ];
      const highlight = documentScanSummary.urgentDocuments[0] || documentScanSummary.newDocuments[0] || documentScanSummary.changedDocuments[0];
      if (highlight) {
        documentLines.push(`Top item: ${highlight.relativePath}${highlight.actionCandidates?.length ? ` | actions: ${highlight.actionCandidates.slice(0, 2).join("; ")}` : ""}`);
      }
      await appendDailyAssistantMemory("Document Briefing", "Native document sweep updated", documentLines, now);
      reportLines.push(`Indexed ${documentScanSummary.totalDocuments} document(s); ${documentScanSummary.newDocuments.length} new, ${documentScanSummary.changedDocuments.length} changed, ${documentScanSummary.urgentDocuments.length} needing attention.`);
    }
    const snapshot = await buildOpportunityWorkspaceSnapshot();
    const opportunities = await planWorkspaceOpportunities(snapshot);
    for (const docEntry of (documentScanSummary?.urgentDocuments || []).slice(0, 4)) {
      const candidate = buildDocumentOpportunity(docEntry);
      if (candidate) {
        opportunities.push(candidate);
      }
    }
    let reservedSlots = 0;
    const pendingOpportunityEntries = [...opportunities];
    let workspaceProjects = await listContainerWorkspaceProjects();
    const totalProjectCapacity = await getTotalBackgroundExecutionCapacity();
    const projectCapacity = Math.max(1, totalProjectCapacity);
    const importedProjects = projectConfig.autoImportProjects
      ? await fillWorkspaceProjectsFromRepositories(projectCapacity)
      : [];
    if (importedProjects.length) {
      const importedNames = importedProjects.map((entry) => String(entry.projectName || "").trim()).filter(Boolean);
      projectRotationSummary = {
        archivedProjects: [],
        importedProjects,
        importedProject: importedProjects[0] || null
      };
      reportLines.push(`Imported fresh project${importedNames.length === 1 ? "" : "s"} into workspace: ${importedNames.join(", ")}.`);
      await appendDailyAssistantMemory(
        "Workspace Rotation",
        "Idle project rotation refreshed Nova's workspace",
        [
          "Archived: none.",
          `Imported: ${importedNames.join(", ")}.`
        ],
        now
      );
      workspaceProjects = await listContainerWorkspaceProjects();
    }

    const activeProjectSummaries = [];
    const exportedProjects = [];
    for (const project of workspaceProjects.slice(0, projectCapacity)) {
      const processedProject = await processWorkspaceProjectForOpportunityScan(project, { now });
      reservedSlots += processedProject.cycleTasks.length;
      activeProjectSummaries.push(processedProject.summary);
      reportLines.push(...processedProject.reportEntries);
      for (const cycleTask of processedProject.cycleTasks) {
        if (!created.find((taskEntry) => taskEntry.id === cycleTask.id)) {
          created.push(cycleTask);
          reportLines.push(`Queued project work: ${cycleTask.codename || cycleTask.id}${cycleTask.projectWorkFocus ? ` (${compactTaskText(cycleTask.projectWorkFocus, 90)})` : ""}.`);
        }
      }
      if (processedProject.exportedProject) {
        exportedProjects.push(processedProject.exportedProject);
      }
    }
    if (projectConfig.autoImportProjects && exportedProjects.length) {
      const replacementProjects = await fillWorkspaceProjectsFromRepositories(projectCapacity);
      if (replacementProjects.length) {
        const replacementNames = replacementProjects.map((entry) => String(entry.projectName || "").trim()).filter(Boolean);
        const existingImportedProjects = Array.isArray(projectRotationSummary?.importedProjects)
          ? projectRotationSummary.importedProjects
          : (projectRotationSummary?.importedProject ? [projectRotationSummary.importedProject] : []);
        projectRotationSummary = {
          ...(projectRotationSummary || { archivedProjects: [], importedProjects: [] }),
          importedProjects: [...existingImportedProjects, ...replacementProjects],
          importedProject: existingImportedProjects[0] || replacementProjects[0] || null
        };
        reportLines.push(`Imported replacement project${replacementNames.length === 1 ? "" : "s"} into workspace: ${replacementNames.join(", ")}.`);
        await appendDailyAssistantMemory(
          "Workspace Rotation",
          "Completed project export triggered a workspace refill",
          [
            `Exported: ${exportedProjects.map((entry) => entry.name).join(", ")}.`,
            `Imported: ${replacementNames.join(", ")}.`
          ],
          now
        );
        const replacementProjectNames = new Set(replacementNames.map((entry) => entry.toLowerCase()));
        const refreshedWorkspaceProjects = await listContainerWorkspaceProjects();
        for (const project of refreshedWorkspaceProjects.slice(0, projectCapacity)) {
          if (!replacementProjectNames.has(String(project?.name || "").trim().toLowerCase())) {
            continue;
          }
          const processedProject = await processWorkspaceProjectForOpportunityScan(project, { now });
          reservedSlots += processedProject.cycleTasks.length;
          activeProjectSummaries.push(processedProject.summary);
          reportLines.push(...processedProject.reportEntries);
          for (const cycleTask of processedProject.cycleTasks) {
            if (!created.find((taskEntry) => taskEntry.id === cycleTask.id)) {
              created.push(cycleTask);
              reportLines.push(`Queued project work: ${cycleTask.codename || cycleTask.id}${cycleTask.projectWorkFocus ? ` (${compactTaskText(cycleTask.projectWorkFocus, 90)})` : ""}.`);
            }
          }
        }
      }
    }
    activeProjectSummary = activeProjectSummaries;
    const helperScoutBrains = await chooseHelperScoutBrains(4);
    for (const helperScoutBrain of helperScoutBrains) {
      const scoutTask = await queueHelperScoutTask(helperScoutBrain, now);
      if (scoutTask && !created.find((entry) => entry.id === scoutTask.id)) {
        created.push(scoutTask);
        reportLines.push(`Queued helper scout: ${helperScoutBrain.label || helperScoutBrain.id}.`);
      }
    }
    if (exportedProjects.length) {
      projectRotationSummary = {
        ...(projectRotationSummary || { archivedProjects: [], importedProjects: [] }),
        exportedProjects,
        exportedProject: exportedProjects[0] || null
      };
    }
    const nonProjectCreatedCount = created.filter((entry) => !["project_cycle", "helper_scout"].includes(String(entry.internalJobType || ""))).length;
    const remainingCapacity = Math.max(0, availableWorkSlots - reservedSlots - nonProjectCreatedCount);
    if (remainingCapacity > 0) {
      let queuedOpportunities = 0;
      for (const entry of pendingOpportunityEntries) {
        if (queuedOpportunities >= remainingCapacity) {
          break;
        }
        const message = String(entry?.message || "").trim();
        const specialtyHint = String(entry?.specialtyHint || inferTaskSpecialty(entry)).trim().toLowerCase() || "general";
        const preferredWorker = await chooseIdleWorkerBrainForSpecialty(specialtyHint);
        const opportunityKey = String(entry?.key || `opp-${hashRef(message)}`).trim() || `opp-${hashRef(message)}`;
        if (!message) {
          continue;
        }
        if (isBogusOrMetaOpportunityMessage(message)) {
          continue;
        }
        if (!entry?.sourceTaskId && !entry?.sourceDocumentPath && !entry?.projectName) {
          continue;
        }
        if (created.some((taskEntry) => String(taskEntry.opportunityKey || "") === opportunityKey)) {
          continue;
        }
        if (Number(opportunityScanState.recentKeys?.[opportunityKey] || 0) >= now - projectConfig.opportunityScanRetentionMs) {
          continue;
        }
        const existing = await findTaskByOpportunityKey(opportunityKey);
        if (existing) {
          opportunityScanState.recentKeys[opportunityKey] = now;
          continue;
        }
        const taskCreated = await createQueuedTask({
          message,
          sessionId: "opportunity-scan",
          requestedBrainId: preferredWorker?.id || "worker",
          intakeBrainId: "bitnet",
          internetEnabled: Boolean(observerConfig.defaults.internetEnabled),
          selectedMountIds: Array.isArray(observerConfig.defaults.mountIds) ? observerConfig.defaults.mountIds : [],
          forceToolUse: true,
          notes: `Queued from idle workspace opportunity scan. ${String(entry?.reason || "").trim()}`.trim(),
          taskMeta: {
            opportunityKey,
            opportunityReason: String(entry?.reason || "").trim(),
            specialtyHint,
            ...(entry?.sourceTaskId ? { sourceTaskId: String(entry.sourceTaskId).trim() } : {}),
            ...(entry?.sourceDocumentPath ? { sourceDocumentPath: String(entry.sourceDocumentPath).trim() } : {}),
            ...(entry?.projectName ? { projectName: String(entry.projectName).trim() } : {}),
            ...(entry?.projectPath ? { projectPath: String(entry.projectPath).trim() } : {})
          }
        });
        opportunityScanState.recentKeys[opportunityKey] = now;
        created.push(taskCreated);
        queuedOpportunities += 1;
        reportLines.push(`Queued ${taskCreated.codename || taskCreated.id}: ${compactTaskText(message, 180)}`);
      }
    }
    reportLines.push(`Idle worker brains available: ${idleWorkerBrains}.`);
    reportLines.push(`Idle helper brains available: ${idleHelperBrains}.`);
    opportunityScanState.lastScanAt = now;
    opportunityScanState.nextMode = "cleanup";
  } else {
    const closedInternalPeriodicCount = await closeCompletedInternalPeriodicTasks();
    if (closedInternalPeriodicCount) {
      closedCount += closedInternalPeriodicCount;
      reportLines.push(`Closed ${closedInternalPeriodicCount} completed internal periodic task${closedInternalPeriodicCount === 1 ? "" : "s"}.`);
    }
    const maintenanceCandidates = await buildTaskMaintenanceSnapshot(8);
    const maintenancePlans = await planTaskMaintenanceActions(maintenanceCandidates);
    for (const plan of maintenancePlans.slice(0, 8)) {
      const taskId = String(plan?.taskId || "").trim();
      const action = String(plan?.action || "").trim();
      const reason = String(plan?.reason || "").trim();
      const reviewedTask = maintenanceCandidates.find((entry) => entry.id === taskId);
      if (!reviewedTask) {
        continue;
      }
      const liveTask = await findTaskById(taskId);
      if (!liveTask || liveTask.maintenanceReviewedAt || liveTask.status === "closed") {
        continue;
      }
      if (action === "follow_up") {
        const followUpMessage = buildFailureInvestigationTaskMessage(liveTask, String(plan?.followUpMessage || "").trim());
        if (!followUpMessage) {
          continue;
        }
        const maintenanceKey = `maint-${taskId}-${hashRef(followUpMessage)}`;
        const existing = await findTaskByMaintenanceKey(maintenanceKey);
        if (!existing) {
          const reshapeRecord = await recordTaskReshapeReview({
            task: liveTask,
            sourceTask: liveTask,
            phase: "maintenance_review",
            action: "reshape_resubmit",
            reason,
            improvement: followUpMessage,
            classification: String(liveTask.failureClassification || "").trim(),
            willResubmit: true
          });
          await createQueuedTask({
            message: followUpMessage,
            sessionId: "task-maintenance",
            requestedBrainId: "worker",
            intakeBrainId: "bitnet",
            internetEnabled: Boolean(observerConfig.defaults.internetEnabled),
            selectedMountIds: Array.isArray(observerConfig.defaults.mountIds) ? observerConfig.defaults.mountIds : [],
            forceToolUse: true,
            notes: `Queued from idle maintenance review of ${liveTask.codename || liveTask.id}. ${reason}`.trim(),
            taskMeta: buildRetryTaskMeta(liveTask, {
              maintenanceKey,
              parentTaskId: liveTask.id,
              previousTaskId: liveTask.id,
              maintenanceSourceStatus: liveTask.status,
              reshapeIssueKey: String(reshapeRecord?.issueKey || "").trim() || undefined,
              reshapeSourcePhase: "maintenance_review"
            })
          });
        }
        await closeTaskRecord(liveTask, `Advanced into follow-up work. ${reason}`.trim());
        advancedCount += 1;
        reportLines.push(`Advanced ${liveTask.codename || liveTask.id}: ${reason || "Queued a follow-up task."}`);
        continue;
      }
      if (String(reason || "").toLowerCase().startsWith("critical failure after")) {
        await recordTaskReshapeReview({
          task: liveTask,
          sourceTask: liveTask,
          phase: "maintenance_review",
          action: "critical_close",
          reason,
          classification: String(liveTask.failureClassification || "").trim(),
          willResubmit: false,
          critical: true
        });
        await markTaskCriticalFailure(liveTask, reason);
      }
      await closeTaskRecord(liveTask, reason || "Reviewed during idle maintenance and closed.");
      closedCount += 1;
      reportLines.push(`Closed ${liveTask.codename || liveTask.id}: ${reason || "Reviewed during idle maintenance and closed."}`);
    }
    archivedCount = await archiveExpiredCompletedTasks();
    if (archivedCount) {
      reportLines.push(`Archived ${archivedCount} older settled task${archivedCount === 1 ? "" : "s"}.`);
    }
    opportunityScanState.lastCleanupAt = now;
    opportunityScanState.nextMode = "scan";
  }
  if (created.length) {
    opportunityScanState.lastCreatedAt = now;
  }
  await saveOpportunityScanState();
  const helperScoutCreatedCount = created.filter((entry) => String(entry.internalJobType || "") === "helper_scout").length;
  const projectWorkCreatedCount = created.filter((entry) => String(entry.internalJobType || "") === "project_cycle").length;
  const groundedOpportunityCount = created.filter((entry) =>
    !["helper_scout", "project_cycle"].includes(String(entry.internalJobType || ""))
  ).length;
  const groundedWorkCount = projectWorkCreatedCount + groundedOpportunityCount;
  const summaryParts = [];
  if (documentScanSummary) {
    summaryParts.push(`indexed ${documentScanSummary.totalDocuments} document${documentScanSummary.totalDocuments === 1 ? "" : "s"}`);
    if (documentScanSummary.newDocuments.length) summaryParts.push(`${documentScanSummary.newDocuments.length} new document${documentScanSummary.newDocuments.length === 1 ? "" : "s"}`);
    if (documentScanSummary.changedDocuments.length) summaryParts.push(`${documentScanSummary.changedDocuments.length} changed document${documentScanSummary.changedDocuments.length === 1 ? "" : "s"}`);
  }
  if (Array.isArray(activeProjectSummary) && activeProjectSummary.length) {
    summaryParts.push(`tracked ${activeProjectSummary.length} active project${activeProjectSummary.length === 1 ? "" : "s"}`);
    const queuedProjectWorkCount = activeProjectSummary.reduce((count, entry) => (
      count + (Array.isArray(entry?.queuedTasks) ? entry.queuedTasks.filter((task) => task?.id).length : 0)
    ), 0);
    if (queuedProjectWorkCount) summaryParts.push(`queued ${queuedProjectWorkCount} project work item${queuedProjectWorkCount === 1 ? "" : "s"}`);
  }
  if (executionCapacity > 1) summaryParts.push(`used ${executionCapacity} execution lanes`);
  const importedProjects = Array.isArray(projectRotationSummary?.importedProjects)
    ? projectRotationSummary.importedProjects
    : (projectRotationSummary?.importedProject ? [projectRotationSummary.importedProject] : []);
  const exportedProjects = Array.isArray(projectRotationSummary?.exportedProjects)
    ? projectRotationSummary.exportedProjects
    : (projectRotationSummary?.exportedProject ? [projectRotationSummary.exportedProject] : []);
  if (importedProjects.length) summaryParts.push(`imported ${importedProjects.length} project${importedProjects.length === 1 ? "" : "s"}`);
  if (exportedProjects.length) summaryParts.push(`exported ${exportedProjects.length} project${exportedProjects.length === 1 ? "" : "s"}`);
  if (groundedWorkCount) summaryParts.push(`queued ${groundedWorkCount} grounded work item${groundedWorkCount === 1 ? "" : "s"}`);
  if (helperScoutCreatedCount) summaryParts.push(`queued ${helperScoutCreatedCount} helper scout${helperScoutCreatedCount === 1 ? "" : "s"}`);
  const createdTicketRefs = created
    .filter((entry) => entry?.id)
    .slice(0, 4)
    .map((entry) => {
      const ref = String(entry.codename || entry.id || "").trim();
      const focus = compactTaskText(
        String(entry.projectWorkFocus || entry.message || entry.notes || "").trim(),
        90
      );
      return focus ? `${ref} (${focus})` : ref;
    })
    .filter(Boolean);
  if (createdTicketRefs.length) {
    summaryParts.push(`generated tickets: ${createdTicketRefs.join("; ")}${created.length > createdTicketRefs.length ? "; and more" : ""}`);
  }
  if (advancedCount) summaryParts.push(`advanced ${advancedCount} reviewed task${advancedCount === 1 ? "" : "s"}`);
  if (closedCount) summaryParts.push(`closed ${closedCount} reviewed task${closedCount === 1 ? "" : "s"}`);
  if (archivedCount) summaryParts.push(`archived ${archivedCount} older settled task${archivedCount === 1 ? "" : "s"}`);
  const summary = summaryParts.length
    ? `Idle ${wakeMode === "scan" ? "opportunity scan" : "cleanup"} report: ${summaryParts.join(", ")}.`
    : `Idle ${wakeMode === "scan" ? "opportunity scan" : "cleanup"} report: no action was needed.`;
  await appendQueueMaintenanceReport(summary, reportLines);
  return {
    ok: true,
    code: 0,
    timedOut: false,
    preset: "internal-opportunity-scan",
    brain: AGENT_BRAINS[0],
    network: "local",
    mounts: [],
    attachments: [],
    outputFiles: [],
    parsed: { status: "ok", result: { payloads: [{ text: summary, mediaUrl: null }], meta: { durationMs: 0, createdTasks: created.length, wakeMode, advancedCount, closedCount, archivedCount } } },
    stdout: summary,
    stderr: ""
  };
}

async function ensureOpportunityScanJob() {
  const projectConfig = getProjectConfig();
  const [queued, inProgress, done, failed, closed] = await Promise.all([
    listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
    listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress"),
    listTasksByFolder(TASK_QUEUE_DONE, "done"),
    Promise.resolve([]),
    listTasksByFolder(TASK_QUEUE_CLOSED, "closed")
  ]);
  const doneFailed = done.filter((task) => String(task.status || "").toLowerCase() === "failed");
  const doneCompleted = done.filter((task) => String(task.status || "").toLowerCase() !== "failed");
  const active = [...queued, ...inProgress].find((task) => String(task.internalJobType || "") === "opportunity_scan");
  if (active) {
    return active;
  }
  const latestHistorical = [...doneCompleted, ...doneFailed, ...failed, ...closed]
    .filter((task) => String(task.internalJobType || "") === "opportunity_scan")
    .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))[0];
  if (latestHistorical?.status === "completed" && Number(latestHistorical.notBeforeAt || 0) > Date.now()) {
    return latestHistorical;
  }
  return createQueuedTask({
    message: "Idle workspace opportunity scan",
    sessionId: "scheduler",
    requestedBrainId: "worker",
    intakeBrainId: "bitnet",
    internetEnabled: false,
    selectedMountIds: [],
    forceToolUse: false,
    notes: "Internal periodic worker job for idle workspace opportunity scanning.",
    taskMeta: {
      internalJobType: "opportunity_scan",
      scheduler: {
        periodic: true,
        name: "Idle workspace opportunity scan",
        seriesId: "internal-opportunity-scan",
        every: "1m",
        everyMs: projectConfig.opportunityScanIntervalMs
      },
      notBeforeAt: Date.now() + projectConfig.opportunityScanIntervalMs
    }
  });
}

  return {
    ensureOpportunityScanJob,
    executeOpportunityScanJob
  };
}
