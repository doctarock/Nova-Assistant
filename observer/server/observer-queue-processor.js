export function createObserverQueueProcessor(context = {}) {
  const {
    MAX_TASK_RESHAPE_ATTEMPTS,
    OBSERVER_CONTAINER_OUTPUT_ROOT,
    TASK_PROGRESS_HEARTBEAT_MS,
    TASK_QUEUE_DONE,
    TASK_QUEUE_INBOX,
    TASK_QUEUE_IN_PROGRESS,
    VISIBLE_COMPLETED_HISTORY_COUNT,
    WORKSPACE_ROOT,
    addTodoItem,
    appendFailureTelemetryEntry,
    broadcast,
    broadcastObserverEvent,
    buildCapabilityMismatchRetryMessage,
    buildCompletionReviewSummary,
    buildQueuedTaskExecutionPrompt,
    buildTaskResumeSummary = async () => null,
    buildRetryTaskMeta,
    buildTodoTextFromWaitingQuestion,
    canReshapeTask,
    chooseAutomaticRetryBrainId,
    classifyFailureText,
    closeTaskRecord,
    compactTaskText,
    createQueuedTask,
    executeCreativeHandoffPass,
    executeEscalationReviewJob,
    executeHelperScoutJob,
    executeMailWatchJob,
    executeObserverRun,
    executeOpportunityScanJob,
    executeQuestionMaintenanceJob,
    executeRecreationJob,
    extractContainerPathCandidates,
    findIndexedTaskById,
    findRecentCronTaskRuns,
    formatDateTimeForUser,
    formatElapsedShort,
    formatEntityRef,
    fs,
    getAutoCloseCompletedInternalTaskReason,
    getBrain,
    getObserverConfig,
    getQueueConfig,
    getRoutingConfig,
    getTaskReshapeAttemptCount,
    getTaskRootId,
    isAutoCloseCompletedInternalTask,
    isCanonicalInProgressTaskRun,
    isCapabilityMismatchFailure,
    isImmediateInternalNoopCompletion,
    isRemoteParallelDispatchEnabled,
    isTodoBackedWaitingTask,
    isTransportFailoverFailure,
    listTasksByFolder,
    markTaskCriticalFailure,
    normalizeOllamaBaseUrl,
    path,
    persistTaskTransition,
    recordTaskReshapeReview,
    recoverConflictingInProgressLaneTasks,
    recoverStaleInProgressTasks,
    recoverStaleTaskDispatchLock,
    renderCreativeHandoffPacket,
    resolveSourcePathFromContainerPath,
    runPluginHook = async (_, payload) => payload,
    runWorkerTaskPreflight,
    scheduleTaskDispatch,
    selectDispatchableQueuedTask,
    shouldKeepTaskVisible,
    shouldRouteWaitingTaskToTodo,
    summarizePayloadText,
    summarizeRunArtifacts,
    writeVolumeText,
    activeTaskControllers,
    getTaskDispatchInFlight,
    setTaskDispatchInFlight,
    setTaskDispatchStartedAt
  } = context;

  async function processNextQueuedTask(preferredBrainId = "") {
    if (getObserverConfig()?.queue?.paused === true) {
      return { ok: true, dispatched: false, message: "Queue is paused." };
    }
    await recoverStaleTaskDispatchLock();
    if (getTaskDispatchInFlight()) {
      return { ok: true, dispatched: false, message: "Task dispatch already in flight." };
    }

    setTaskDispatchInFlight(true);
    setTaskDispatchStartedAt(Date.now());
    let dispatchLockReleased = false;
    try {
      const recoveredTasks = await recoverStaleInProgressTasks();
      const laneRecoveredTasks = await recoverConflictingInProgressLaneTasks();
      if (recoveredTasks.length) {
        broadcast(`[observer] recovered ${recoveredTasks.length} stale queued task(s)`);
      }
      if (laneRecoveredTasks.length) {
        broadcast(`[observer] recovered ${laneRecoveredTasks.length} queued task(s) from lane conflicts`);
      }
      const tasks = (await listTasksByFolder(TASK_QUEUE_INBOX, "queued"))
        .filter((entry) => String(entry.status || "queued") === "queued");
      if (!tasks.length) {
        return { ok: true, dispatched: false, message: "No queued tasks." };
      }

      const remoteParallel = await isRemoteParallelDispatchEnabled();
      const selection = await selectDispatchableQueuedTask(tasks, { preferredBrainId, remoteParallel });
      let task = selection.task;
      if (!task) {
        return {
          ok: true,
          dispatched: false,
          message: selection.message || "No due queued tasks.",
          activeTask: selection.activeTask
        };
      }

      const preflight = await runWorkerTaskPreflight(task);
      if (preflight.action === "clarify" && String(preflight.question || "").trim()) {
        const now = Date.now();
        const waitingTask = await persistTaskTransition({
          previousTask: task,
          nextTask: {
            ...task,
            status: "waiting_for_user",
            updatedAt: now,
            waitingForUserAt: now,
            answerPending: true,
            questionForUser: compactTaskText(String(preflight.question || "").trim(), 2000),
            notes: compactTaskText(
              `Worker preflight requested clarification before execution.${preflight.reason ? ` ${preflight.reason}` : ""}`,
              260
            ),
            originalMessage: String(task.originalMessage || task.message || "").trim(),
            message: String(task.message || "").trim()
          },
          previousPath: task.filePath,
          eventType: "task.waiting",
          reason: `Worker preflight requested clarification.${preflight.reason ? ` ${preflight.reason}` : ""}`
        });
        broadcastObserverEvent({
          type: "task.waiting",
          task: waitingTask
        });
        return {
          ok: true,
          dispatched: false,
          message: "Task requires clarification before worker execution.",
          task: waitingTask
        };
      }
      if (preflight.action === "proceed" && String(preflight.optimizedMessage || "").trim()) {
        task = {
          ...task,
          message: String(preflight.optimizedMessage || "").trim(),
          notes: compactTaskText(
            `${String(task.notes || "").trim()}${preflight.reason ? ` Worker preflight: ${preflight.reason}` : ""}`.trim(),
            260
          )
        };
      }

      const inboxPath = task.filePath;
      const startedAt = Date.now();
      const brain = await getBrain(task.requestedBrainId || "worker");
      const inProgressTask = await persistTaskTransition({
        previousTask: task,
        nextTask: {
          ...task,
          status: "in_progress",
          updatedAt: startedAt,
          startedAt,
          queueLane: String(task.queueLane || "").trim(),
          ollamaBaseUrl: normalizeOllamaBaseUrl(String(task.ollamaBaseUrl || "").trim() || String(brain?.ollamaBaseUrl || "").trim()),
          dispatchCount: Number(task.dispatchCount || 0) + 1,
          specialistAttemptedBrainIds: [
            ...new Set([...(Array.isArray(task.specialistAttemptedBrainIds) ? task.specialistAttemptedBrainIds : []), String(task.requestedBrainId || "worker")])
          ]
        },
        previousPath: inboxPath,
        eventType: "task.started",
        reason: `Task dispatched to ${brain.label || brain.id}.`
      });
      const inProgressPath = inProgressTask.filePath;
      await runPluginHook("queue:task-dispatch-started", {
        at: startedAt,
        taskId: String(inProgressTask.id || "").trim(),
        sessionId: String(inProgressTask.sessionId || "").trim(),
        brainId: String(brain?.id || inProgressTask.requestedBrainId || "").trim(),
        brainLabel: String(brain?.label || inProgressTask.requestedBrainLabel || "").trim(),
        queueLane: String(inProgressTask.queueLane || "").trim(),
        dispatchCount: Number(inProgressTask.dispatchCount || 0) || 0,
        internalJobType: String(inProgressTask.internalJobType || "").trim(),
        task: inProgressTask
      }).catch(() => {});

      if (remoteParallel) {
        setTaskDispatchInFlight(false);
        setTaskDispatchStartedAt(0);
        dispatchLockReleased = true;
        scheduleTaskDispatch(25);
      }

      const trackedWorkspacePaths = extractContainerPathCandidates(
        String(inProgressTask.originalMessage || inProgressTask.message || "")
      )
        .map((candidate) => resolveSourcePathFromContainerPath(candidate))
        .filter(Boolean);
      const taskRuntimeNotes = [
        `Task id: ${inProgressTask.id}`,
        `Task codename: ${inProgressTask.codename}.`,
        `Task source: queued handoff from ${inProgressTask.intakeBrainId || "bitnet"}.`
      ];
      if (inProgressTask.helperAnalysis?.summary || inProgressTask.helperAnalysis?.intent) {
        taskRuntimeNotes.push("Helper analysis from the original request:");
        if (inProgressTask.helperAnalysis.summary) {
          taskRuntimeNotes.push(`- Summary: ${inProgressTask.helperAnalysis.summary}`);
        }
        if (inProgressTask.helperAnalysis.intent) {
          taskRuntimeNotes.push(`- Intent: ${inProgressTask.helperAnalysis.intent}`);
        }
        if (inProgressTask.helperAnalysis.suggestedAction) {
          taskRuntimeNotes.push(`- Suggested action: ${inProgressTask.helperAnalysis.suggestedAction}`);
        }
        if (inProgressTask.helperAnalysis.reasons?.length) {
          taskRuntimeNotes.push(`- Reasons: ${inProgressTask.helperAnalysis.reasons.join("; ")}`);
        }
      }
      if (trackedWorkspacePaths.length) {
        taskRuntimeNotes.push("Task-relevant workspace paths:");
        for (const trackedPath of trackedWorkspacePaths.slice(0, 4)) {
          const relative = path.relative(WORKSPACE_ROOT, trackedPath).replaceAll("\\", "/") || ".";
          taskRuntimeNotes.push(`- ${relative}`);
          try {
            const stats = await fs.stat(trackedPath);
            if (stats.isDirectory()) {
              const entries = (await fs.readdir(trackedPath, { withFileTypes: true }))
                .filter((entry) => ![".git", "node_modules"].includes(entry.name))
                .slice(0, 8)
                .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
              if (entries.length) {
                taskRuntimeNotes.push(`  Top entries: ${entries.join(", ")}`);
              }
            }
          } catch {
            // ignore snapshot failures
          }
        }
      }
      if (Array.isArray(inProgressTask.clarificationHistory) && inProgressTask.clarificationHistory.length) {
        taskRuntimeNotes.push("User clarification history:");
        for (const [index, entry] of inProgressTask.clarificationHistory.slice(-4).entries()) {
          const question = compactTaskText(String(entry?.question || "").trim(), 240) || "(question not captured)";
          const answer = compactTaskText(String(entry?.answer || "").trim(), 240) || "(empty answer)";
          taskRuntimeNotes.push(`- ${index + 1}. Question: ${question}`);
          taskRuntimeNotes.push(`  Answer: ${answer}`);
        }
      }
      const resumeSummary = await buildTaskResumeSummary(String(inProgressTask.id || "").trim()).catch(() => null);
      if (resumeSummary) {
        taskRuntimeNotes.push(resumeSummary);
      }
      let taskPrompt = String(inProgressTask.message || "").trim();
      if (inProgressTask.scheduler?.periodic) {
        const recentCronRuns = await findRecentCronTaskRuns(inProgressTask.scheduler.seriesId, 2);
        taskRuntimeNotes.push(`Scheduler task: ${inProgressTask.scheduler.name || inProgressTask.scheduler.seriesId}.`);
        if (inProgressTask.scheduler.every) {
          taskRuntimeNotes.push(`Schedule: every ${inProgressTask.scheduler.every}.`);
        }
        taskRuntimeNotes.push("This is a scheduled background task, not an interactive user chat.");
        taskRuntimeNotes.push("Interpret the job message as the task brief, execute it, and return a concise outcome summary.");
        taskRuntimeNotes.push("Your reply should state what you checked, what changed, and whether follow-up is needed.");
        if (recentCronRuns.length) {
          taskRuntimeNotes.push("Most recent runs of this scheduled task:");
          for (const previousTask of recentCronRuns) {
            const completedAt = formatDateTimeForUser(previousTask.completedAt || previousTask.updatedAt || previousTask.createdAt);
            const summary = compactTaskText(previousTask.resultSummary || previousTask.notes || previousTask.message, 160);
            taskRuntimeNotes.push(`- ${completedAt}: ${summary}`);
          }
        }
        taskPrompt = [
          "Scheduled task execution.",
          `Task: ${inProgressTask.scheduler.name || inProgressTask.scheduler.seriesId}`,
          inProgressTask.scheduler.every ? `Cadence: every ${inProgressTask.scheduler.every}` : "",
          `Task brief: ${String(inProgressTask.message || "").trim()}`,
          "Respond with the outcome of this run rather than chatting conversationally."
        ].filter(Boolean).join("\n");
      }
      if (/\b(copy|move|duplicate|export|archive|package|zip|bundle)\b/i.test(String(inProgressTask.message || ""))) {
        taskRuntimeNotes.push(`If this task is about copying or exporting files for the user, write them into ${OBSERVER_CONTAINER_OUTPUT_ROOT} and return a short confirmation naming the created folder or file.`);
      }
      if (Array.isArray(inProgressTask.attachments) && inProgressTask.attachments.length) {
        taskRuntimeNotes.push("Task attachments are already present in the workspace at these paths:");
        for (const attachment of inProgressTask.attachments) {
          taskRuntimeNotes.push(`- ${attachment.containerPath} (${attachment.type}, original name: ${attachment.originalName})`);
        }
      }
      const taskAbortController = new AbortController();
      activeTaskControllers.set(inProgressTask.id, taskAbortController);
      let creativeHandoff = { used: false, reason: "not_requested" };
      if (String(inProgressTask.creativeHandoffBrainId || "").trim()) {
        try {
          creativeHandoff = await executeCreativeHandoffPass({
            task: inProgressTask,
            trackedWorkspacePaths,
            abortSignal: taskAbortController.signal
          });
        } catch (error) {
          creativeHandoff = {
            used: false,
            reason: "creative_handoff_exception",
            error: String(error?.message || error || "").trim()
          };
        }
      }
      if (creativeHandoff?.used && creativeHandoff.packet) {
        taskRuntimeNotes.push(`Creative handoff prepared by ${creativeHandoff.brainLabel || creativeHandoff.brainId || inProgressTask.creativeHandoffBrainId}.`);
        taskRuntimeNotes.push(`Creative handoff summary: ${creativeHandoff.packet.summary}`);
        taskPrompt = [
          taskPrompt,
          "",
          "Use the creative handoff packet below as source material for this task.",
          "Apply it concretely to workspace files when it fits the brief instead of merely restating it.",
          renderCreativeHandoffPacket(creativeHandoff.packet)
        ].filter(Boolean).join("\n");
      } else if (String(creativeHandoff?.error || "").trim()) {
        taskRuntimeNotes.push(`Creative handoff was unavailable: ${creativeHandoff.error}`);
      }
      let heartbeatCount = 0;
      let heartbeatTimer = null;
      let heartbeatStopped = false;
      const suppressProgressBroadcasts = await isRemoteParallelDispatchEnabled();
      const queueHeartbeat = () => {
        if (heartbeatStopped) {
          return;
        }
        heartbeatTimer = setTimeout(async () => {
          if (heartbeatStopped || taskAbortController.signal.aborted) {
            return;
          }
          try {
            const canonicalTask = await findIndexedTaskById(inProgressTask.id);
            if (!isCanonicalInProgressTaskRun(canonicalTask, inProgressTask, inProgressPath)) {
              heartbeatStopped = true;
              return;
            }
            heartbeatCount += 1;
            const heartbeatAt = Date.now();
            const heartbeatTask = {
              ...inProgressTask,
              updatedAt: heartbeatAt,
              lastHeartbeatAt: heartbeatAt,
              heartbeatCount,
              progressNote: suppressProgressBroadcasts ? "" : `Still running for ${formatElapsedShort(heartbeatAt - startedAt)}.`,
              notes: `Still running on ${brain.label || brain.id} after ${formatElapsedShort(heartbeatAt - startedAt)}.`
            };
            await writeVolumeText(inProgressPath, `${JSON.stringify(heartbeatTask, null, 2)}\n`);
            if (!suppressProgressBroadcasts) {
              broadcastObserverEvent({
                type: "task.progress",
                task: heartbeatTask
              });
            }
          } catch (error) {
            broadcast(`[observer] task heartbeat failed ${inProgressTask.id}: ${error.message}`);
          } finally {
            queueHeartbeat();
          }
        }, TASK_PROGRESS_HEARTBEAT_MS);
      };
      queueHeartbeat();

      let runResponse;
      try {
        if (String(inProgressTask.internalJobType || "") === "opportunity_scan") {
          runResponse = await executeOpportunityScanJob(inProgressTask);
        } else if (String(inProgressTask.internalJobType || "") === "mail_watch") {
          runResponse = await executeMailWatchJob(inProgressTask);
        } else if (String(inProgressTask.internalJobType || "") === "question_maintenance") {
          runResponse = await executeQuestionMaintenanceJob(inProgressTask);
        } else if (String(inProgressTask.internalJobType || "") === "helper_scout") {
          runResponse = await executeHelperScoutJob(inProgressTask);
        } else if (String(inProgressTask.internalJobType || "") === "escalation_review") {
          runResponse = await executeEscalationReviewJob(inProgressTask);
        } else if (String(inProgressTask.internalJobType || "") === "agent_recreation") {
          runResponse = await executeRecreationJob(inProgressTask);
        } else {
          runResponse = await executeObserverRun({
            message: await buildQueuedTaskExecutionPrompt(taskPrompt, inProgressTask),
            sessionId: `${inProgressTask.sessionId}-task-${inProgressTask.id}`,
            brain,
            internetEnabled: Boolean(inProgressTask.internetEnabled),
            selectedMountIds: Array.isArray(inProgressTask.mountIds) ? inProgressTask.mountIds : [],
            forceToolUse: Boolean(inProgressTask.forceToolUse),
            preset: "queued-task",
            attachments: [],
            runtimeNotesExtra: taskRuntimeNotes,
            taskContext: {
              taskId: String(inProgressTask.id || "").trim(),
              sessionId: String(inProgressTask.sessionId || "").trim(),
              taskMeta: inProgressTask.taskMeta && typeof inProgressTask.taskMeta === "object"
                ? inProgressTask.taskMeta
                : {}
            },
            abortSignal: taskAbortController.signal
          });
        }
      } finally {
        activeTaskControllers.delete(inProgressTask.id);
        heartbeatStopped = true;
        if (heartbeatTimer) {
          clearTimeout(heartbeatTimer);
        }
      }

      let finalTask;
      try {
        const canonicalTask = await findIndexedTaskById(inProgressTask.id);
        if (!isCanonicalInProgressTaskRun(canonicalTask, inProgressTask, inProgressPath)) {
          return {
            ok: false,
            dispatched: true,
            task: canonicalTask,
            run: {
              ...runResponse,
              abandoned: true
            },
            message: "Task run no longer owns the canonical in_progress slot."
          };
        }
        const textSummary = summarizePayloadText(runResponse.parsed);
        const artifactSummary = summarizeRunArtifacts(runResponse);
        const internalJobType = String(inProgressTask.internalJobType || "").trim();
        const rawInternalSummary = textSummary || artifactSummary || runResponse.stderr || runResponse.error || "";
        const reviewedSummary = ["opportunity_scan", "mail_watch", "question_maintenance", "agent_recreation"].includes(internalJobType)
          ? (
            internalJobType === "agent_recreation"
              ? rawInternalSummary
              : compactTaskText(rawInternalSummary, 420)
          )
          : await buildCompletionReviewSummary({
            task: inProgressTask,
            runResponse,
            workerSummary: textSummary,
            artifactSummary
          });

        const completedAt = Date.now();
        const waitingForUser = runResponse.waitingForUser === true && String(runResponse.questionForUser || "").trim();
        const routeWaitingToTodo = waitingForUser && shouldRouteWaitingTaskToTodo(inProgressTask, runResponse.questionForUser);
        const todoText = routeWaitingToTodo ? buildTodoTextFromWaitingQuestion(inProgressTask, runResponse.questionForUser) : "";
        const linkedTodoItem = routeWaitingToTodo
          ? await addTodoItem({
            text: todoText,
            createdBy: "nova",
            source: "task_waiting",
            linkedTaskId: inProgressTask.id,
            linkedTaskCodename: inProgressTask.codename || formatEntityRef("task", inProgressTask.id || "unknown"),
            linkedQuestion: String(runResponse.questionForUser || "").trim(),
            completionNote: `User completed todo item: ${todoText || String(runResponse.questionForUser || "").trim()}`
          })
          : null;
        const waitingSummary = waitingForUser ? "" : (reviewedSummary || textSummary || artifactSummary || runResponse.stderr || runResponse.error || "");
        finalTask = {
          ...inProgressTask,
          ...(runResponse.taskMetaUpdates && typeof runResponse.taskMetaUpdates === "object" ? runResponse.taskMetaUpdates : {}),
          status: waitingForUser ? "waiting_for_user" : (runResponse.ok ? "completed" : "failed"),
          updatedAt: completedAt,
          completedAt,
          workerSummary: textSummary || artifactSummary || runResponse.stderr || runResponse.error || "",
          reviewSummary: waitingForUser ? "" : reviewedSummary,
          reviewedAt: completedAt,
          resultSummary: waitingSummary,
          outputFiles: runResponse.outputFiles || [],
          toolLoopDiagnostics: runResponse.toolLoopDiagnostics || undefined,
          malformedResponse: runResponse.malformedResponse || "",
          initialRawResponse: runResponse.initialRawResponse || "",
          retryRawResponse: runResponse.retryRawResponse || "",
          debugRetryRawResponse: runResponse.debugRetryRawResponse || "",
          finalParseError: runResponse.finalParseError || "",
          model: runResponse.brain?.model || brain.model,
          code: runResponse.code,
          aborted: runResponse.aborted === true,
          abortedAt: runResponse.aborted ? Date.now() : Number(inProgressTask.abortedAt || 0) || undefined,
          silentInternalSkip: runResponse.silentInternalSkip === true,
          questionForUser: waitingForUser ? compactTaskText(String(runResponse.questionForUser || "").trim(), 1000) : undefined,
          waitingForUserAt: waitingForUser ? completedAt : undefined,
          waitingMode: linkedTodoItem ? "todo" : "",
          todoItemId: linkedTodoItem?.id || "",
          todoText: linkedTodoItem?.text || "",
          originalMessage: String(inProgressTask.originalMessage || inProgressTask.message || "").trim()
        };
        if (linkedTodoItem) {
          finalTask.notes = compactTaskText(
            `Added to the shared todo list for user action: ${linkedTodoItem.text}`,
            260
          );
        }
        finalTask = await persistTaskTransition({
          previousTask: inProgressTask,
          previousPath: inProgressPath,
          nextTask: finalTask,
          eventType: finalTask.status === "failed"
            ? "task.failed"
            : finalTask.status === "waiting_for_user"
              ? "task.waiting"
              : "task.completed",
          reason: finalTask.resultSummary || finalTask.reviewSummary || finalTask.notes || ""
        });
        const donePath = finalTask.filePath;
        const failureClassification = finalTask.status === "failed"
          ? classifyFailureText(finalTask.resultSummary || finalTask.reviewSummary || finalTask.workerSummary || finalTask.notes || "")
          : "";
        if (finalTask.status === "failed") {
          finalTask.failureClassification = failureClassification;
          finalTask.capabilityMismatchSuspected = isCapabilityMismatchFailure(failureClassification, finalTask);
          finalTask.transportFailoverSuggested = isTransportFailoverFailure(failureClassification, finalTask);
          const failureIssueRecord = await recordTaskReshapeReview({
            task: finalTask,
            sourceTask: finalTask,
            phase: "execution_failure",
            action: "failure_observed",
            classification: failureClassification,
            willResubmit: false
          });
          if (String(failureIssueRecord?.issueKey || "").trim()) {
            finalTask.reshapeIssueKey = String(failureIssueRecord.issueKey).trim();
          }
          await writeVolumeText(donePath, `${JSON.stringify(finalTask, null, 2)}\n`);
          await appendFailureTelemetryEntry({
            task: finalTask,
            phase: "execution",
            summary: finalTask.resultSummary || finalTask.reviewSummary || finalTask.workerSummary || finalTask.notes || "",
            classification: failureClassification
          });
        }

        if (
          finalTask.status === "failed"
          && !finalTask.aborted
        ) {
          const attempted = new Set((Array.isArray(finalTask.specialistAttemptedBrainIds) ? finalTask.specialistAttemptedBrainIds : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean));
          attempted.add(String(finalTask.requestedBrainId || "worker").trim() || "worker");
          const nextBrainId = await chooseAutomaticRetryBrainId(finalTask, failureClassification);
          if (nextBrainId && canReshapeTask(finalTask)) {
            await createQueuedTask({
              message: buildCapabilityMismatchRetryMessage(finalTask, failureClassification) || finalTask.message,
              sessionId: finalTask.sessionId,
              requestedBrainId: nextBrainId,
              intakeBrainId: finalTask.intakeBrainId || "bitnet",
              internetEnabled: Boolean(finalTask.internetEnabled),
              selectedMountIds: Array.isArray(finalTask.mountIds) ? finalTask.mountIds : [],
              forceToolUse: Boolean(finalTask.forceToolUse),
              requireWorkerPreflight: Boolean(finalTask.requireWorkerPreflight),
              attachments: Array.isArray(finalTask.attachments) ? finalTask.attachments : [],
              helperAnalysis: finalTask.helperAnalysis || null,
              notes: finalTask.capabilityMismatchSuspected
                ? `Retrying ${finalTask.codename || finalTask.id} on alternate specialist ${nextBrainId} after ${finalTask.requestedBrainId || "worker"} showed a likely capability mismatch (${failureClassification || "unknown"}).`
                : finalTask.transportFailoverSuggested
                  ? `Retrying ${finalTask.codename || finalTask.id} on alternate idle lane ${nextBrainId} after ${finalTask.requestedBrainId || "worker"} hit a transport timeout/fetch failure (${failureClassification || "unknown"}).`
                  : `Retrying ${finalTask.codename || finalTask.id} on fallback specialist ${nextBrainId} after ${finalTask.requestedBrainId || "worker"} failed.`,
              taskMeta: buildRetryTaskMeta(finalTask, {
                specialistRoute: finalTask.specialistRoute,
                specialistAttemptedBrainIds: [...attempted],
                previousTaskId: finalTask.id,
                failureClassification,
                capabilityMismatchSuspected: finalTask.capabilityMismatchSuspected === true,
                transportFailoverSuggested: finalTask.transportFailoverSuggested === true
              })
            });
            finalTask.notes = compactTaskText(
              `${String(finalTask.notes || "").trim()} ${finalTask.capabilityMismatchSuspected ? "Capability mismatch suspected." : ""}${finalTask.transportFailoverSuggested ? " Transport failover suggested." : ""} Retry queued on ${nextBrainId}.`.trim(),
              260
            );
            await writeVolumeText(donePath, `${JSON.stringify(finalTask, null, 2)}\n`);
          } else if (nextBrainId) {
            finalTask = await markTaskCriticalFailure(
              finalTask,
              `Critical failure after ${getTaskReshapeAttemptCount(finalTask)}/${MAX_TASK_RESHAPE_ATTEMPTS} reshaped resubmission attempts. Automatic specialist retry was skipped.`
            );
            await recordTaskReshapeReview({
              task: finalTask,
              sourceTask: finalTask,
              phase: "execution_retry_gate",
              action: "critical_close",
              reason: finalTask.criticalFailureReason || "",
              classification: failureClassification,
              willResubmit: false,
              critical: true
            });
          }
        }

        const queueConfig = getQueueConfig();
        const routingConfig = getRoutingConfig();
        const attemptedAfterFailure = new Set((Array.isArray(finalTask.specialistAttemptedBrainIds) ? finalTask.specialistAttemptedBrainIds : []).map((value) => String(value)));
        const hasUntriedFallback = Array.isArray(finalTask.specialistRoute?.fallbackBrainIds)
          && finalTask.specialistRoute.fallbackBrainIds.some((id) => !attemptedAfterFailure.has(String(id)));
        const escalationDepth = Number(finalTask.escalationDepth || 0);
        if (
          queueConfig.escalationEnabled
          && finalTask.status === "failed"
          && !finalTask.aborted
          && String(finalTask.internalJobType || "") !== "escalation_review"
          && routingConfig.enabled
          && routingConfig.remoteTriageBrainId
          && !hasUntriedFallback
          && escalationDepth < 2
        ) {
          await createQueuedTask({
            message: finalTask.message,
            sessionId: finalTask.sessionId,
            requestedBrainId: routingConfig.remoteTriageBrainId,
            intakeBrainId: finalTask.intakeBrainId || "bitnet",
            internetEnabled: Boolean(finalTask.internetEnabled),
            selectedMountIds: Array.isArray(finalTask.mountIds) ? finalTask.mountIds : [],
            forceToolUse: false,
            attachments: Array.isArray(finalTask.attachments) ? finalTask.attachments : [],
            helperAnalysis: finalTask.helperAnalysis || null,
            notes: `Queued for escalation review after ${finalTask.requestedBrainId || "worker"} and all fallback workers failed. ${compactTaskText(finalTask.resultSummary || finalTask.notes || "", 180)}`.trim(),
            taskMeta: {
              internalJobType: "escalation_review",
              escalationSourceTaskId: finalTask.id,
              escalationDepth: escalationDepth + 1,
              specialistAttemptedBrainIds: [...attemptedAfterFailure],
              rootTaskId: getTaskRootId(finalTask) || finalTask.id,
              reshapeAttemptCount: getTaskReshapeAttemptCount(finalTask)
            }
          });
          await recordTaskReshapeReview({
            task: finalTask,
            sourceTask: finalTask,
            phase: "execution_failure",
            action: "escalation_review",
            reason: finalTask.resultSummary || finalTask.notes || "",
            classification: failureClassification,
            willResubmit: false
          });
          finalTask.notes = compactTaskText(`${String(finalTask.notes || "").trim()} Escalation review queued on ${routingConfig.remoteTriageBrainId}.`.trim(), 260);
          await writeVolumeText(donePath, `${JSON.stringify(finalTask, null, 2)}\n`);
        }

        let nextScheduler = finalTask.scheduler;
        let nextMailWatchRuleId = String(finalTask.mailWatchRuleId || "").trim();
        if (String(finalTask.internalJobType || "").trim().toLowerCase() === "mail_watch") {
          nextScheduler = null;
          nextMailWatchRuleId = "";
        }
        if (nextScheduler?.periodic && Number(nextScheduler.everyMs || 0) > 0) {
          const schedulerSeriesId = String(nextScheduler.seriesId || "").trim();
          let alreadyQueuedForSeries = false;
          if (schedulerSeriesId) {
            const [queuedPeriodicTasks, runningPeriodicTasks] = await Promise.all([
              listTasksByFolder(TASK_QUEUE_INBOX, "queued"),
              listTasksByFolder(TASK_QUEUE_IN_PROGRESS, "in_progress")
            ]);
            alreadyQueuedForSeries = [...queuedPeriodicTasks, ...runningPeriodicTasks].some((entry) =>
              String(entry.id || "") !== String(finalTask.id || "")
              && String(entry.scheduler?.seriesId || "").trim() === schedulerSeriesId
            );
          }
          if (!alreadyQueuedForSeries) {
            await createQueuedTask({
              message: finalTask.message,
              sessionId: finalTask.sessionId,
              requestedBrainId: finalTask.requestedBrainId || "worker",
              intakeBrainId: finalTask.intakeBrainId || "bitnet",
              internetEnabled: Boolean(finalTask.internetEnabled),
              selectedMountIds: Array.isArray(finalTask.mountIds) ? finalTask.mountIds : [],
              forceToolUse: Boolean(finalTask.forceToolUse),
              notes: `Requeued from periodic scheduler task "${nextScheduler.name || nextScheduler.seriesId}".`,
              taskMeta: {
                ...(finalTask.internalJobType ? { internalJobType: finalTask.internalJobType } : {}),
                ...(finalTask.opportunityKey ? { opportunityKey: finalTask.opportunityKey } : {}),
                ...(finalTask.opportunityReason ? { opportunityReason: finalTask.opportunityReason } : {}),
                ...(nextMailWatchRuleId ? { mailWatchRuleId: nextMailWatchRuleId } : {}),
                scheduler: {
                  ...nextScheduler,
                  lastCompletedAt: completedAt
                },
                notBeforeAt: completedAt + Number(nextScheduler.everyMs || 0)
              }
            });
          }
        }
        if (
          runResponse.ok
          && (
            isImmediateInternalNoopCompletion(finalTask)
            || (
              isAutoCloseCompletedInternalTask(finalTask)
              && (
                String(finalTask.internalJobType || "").trim().toLowerCase() === "escalation_review"
                || !shouldKeepTaskVisible(finalTask, [finalTask, ...(await listTasksByFolder(TASK_QUEUE_DONE, "done"))], VISIBLE_COMPLETED_HISTORY_COUNT)
              )
            )
          )
        ) {
          finalTask = await closeTaskRecord(finalTask, getAutoCloseCompletedInternalTaskReason(finalTask));
        }
      } catch (error) {
        const failedAt = Date.now();
        finalTask = {
          ...inProgressTask,
          status: "failed",
          updatedAt: failedAt,
          completedAt: failedAt,
          workerSummary: runResponse?.stderr || runResponse?.error || "",
          reviewSummary: `Task finalization failed: ${error.message || "unknown error"}`,
          reviewedAt: failedAt,
          resultSummary: `Task finalization failed: ${error.message || "unknown error"}`,
          outputFiles: Array.isArray(runResponse?.outputFiles) ? runResponse.outputFiles : [],
          malformedResponse: runResponse?.malformedResponse || "",
          initialRawResponse: runResponse?.initialRawResponse || "",
          retryRawResponse: runResponse?.retryRawResponse || "",
          debugRetryRawResponse: runResponse?.debugRetryRawResponse || "",
          finalParseError: runResponse?.finalParseError || "",
          model: runResponse?.brain?.model || brain.model,
          code: Number.isFinite(runResponse?.code) ? runResponse.code : 1,
          silentInternalSkip: runResponse?.silentInternalSkip === true,
          notes: `Task finalization failed after execution: ${error.message || "unknown error"}`
        };
        finalTask = await persistTaskTransition({
          previousTask: inProgressTask,
          previousPath: inProgressPath,
          nextTask: finalTask,
          eventType: "task.failed",
          reason: finalTask.resultSummary || finalTask.notes || ""
        });
      }

      const response = {
        ok: ["completed", "closed", "waiting_for_user"].includes(String(finalTask.status || "")),
        dispatched: true,
        task: finalTask,
        run: runResponse
      };
      await runPluginHook("queue:task-processed", {
        at: Date.now(),
        ok: response.ok === true,
        taskId: String(finalTask?.id || "").trim(),
        sessionId: String(finalTask?.sessionId || "").trim(),
        status: String(finalTask?.status || "").trim(),
        durationMs: Math.max(0, Date.now() - startedAt),
        brainId: String(brain?.id || finalTask?.requestedBrainId || "").trim(),
        brainLabel: String(brain?.label || finalTask?.requestedBrainLabel || "").trim(),
        task: finalTask,
        run: runResponse
      }).catch(() => {});
      if (finalTask.status !== "closed" && !finalTask.silentInternalSkip) {
        if (!(finalTask.status === "waiting_for_user" && isTodoBackedWaitingTask(finalTask))) {
          broadcastObserverEvent({
            type: finalTask.status === "waiting_for_user" ? "task.waiting" : "task.completed",
            task: finalTask
          });
        }
      }
      scheduleTaskDispatch();
      return response;
    } finally {
      if (!dispatchLockReleased) {
        setTaskDispatchInFlight(false);
        setTaskDispatchStartedAt(0);
      }
    }
  }

  async function processQueuedTasksToCapacity() {
    const batchStartedAt = Date.now();
    await runPluginHook("queue:batch-started", {
      at: batchStartedAt
    }).catch(() => {});
    const startedTasks = [];
    while (true) {
      const response = await processNextQueuedTask();
      if (!response.dispatched) {
        const result = {
          ok: true,
          dispatched: startedTasks.length > 0,
          startedCount: startedTasks.length,
          tasks: startedTasks,
          message: startedTasks.length
            ? `Started ${startedTasks.length} queued task(s).`
            : response.message
        };
        await runPluginHook("queue:batch-processed", {
          at: Date.now(),
          startedAt: batchStartedAt,
          durationMs: Math.max(0, Date.now() - batchStartedAt),
          ok: true,
          dispatched: result.dispatched === true,
          startedCount: result.startedCount,
          tasks: startedTasks
        }).catch(() => {});
        return result;
      }
      if (response.task) {
        startedTasks.push(response.task);
      }
      if (!(await isRemoteParallelDispatchEnabled())) {
        const result = {
          ok: true,
          dispatched: true,
          startedCount: startedTasks.length,
          tasks: startedTasks,
          message: `Started ${startedTasks.length} queued task(s).`
        };
        await runPluginHook("queue:batch-processed", {
          at: Date.now(),
          startedAt: batchStartedAt,
          durationMs: Math.max(0, Date.now() - batchStartedAt),
          ok: true,
          dispatched: true,
          startedCount: result.startedCount,
          tasks: startedTasks
        }).catch(() => {});
        return result;
      }
    }
  }

  return {
    processNextQueuedTask,
    processQueuedTasksToCapacity
  };
}
