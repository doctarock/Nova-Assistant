export function createObserverExecutionRunner(context = {}) {
  const {
    annotateNovaSpeechText,
    buildPostToolDecisionInstruction,
    buildToolLoopStepDiagnostics,
    buildToolLoopStopMessage,
    buildToolLoopSummaryText,
    buildToolSemanticFailureMessage,
    buildTranscriptForPrompt,
    buildVisionImagesFromAttachments,
    buildWorkerSystemPrompt,
    collectTrackedWorkspaceTargets,
    compactTaskText,
    createToolLoopDiagnostics,
    debugJsonEnvelopeWithPlanner,
    diffFileSnapshots,
    didInspectNamedTarget,
    executeWorkerToolCall,
    extractInspectionTargetKey,
    extractJsonObject,
    buildProjectCycleCompletionPolicy,
    evaluateProjectCycleCompletionState,
    extractProjectCycleImplementationRoots,
    extractProjectCycleProjectRoot,
    extractTaskDirectiveValue,
    filterDestructiveWriteCallsForInPlaceEdit,
    formatToolResultForModel,
    getObserverConfig,
    getProjectNoChangeMinimumTargets,
    getToolResultSemantic,
    isConcreteImplementationInspectionTarget,
    isEchoedToolResultEnvelope,
    isProjectCycleMessage,
    isSemanticallySuccessfulToolResult,
    listObserverOutputFiles,
    listTrackedWorkspaceFiles,
    normalizeAgentSelfReference,
    normalizeContainerPathForComparison,
    normalizeToolCallRecord,
    normalizeToolName,
    normalizeWorkerDecisionEnvelope,
    objectiveRequiresConcreteImprovement,
    looksLikeCapabilityRefusalCompletionSummary,
    parseToolCallArgs,
    prepareAttachments,
    recordToolLoopStepDiagnostics,
    replanRepeatedToolLoopWithPlanner,
    retryJsonEnvelope,
    runOllamaPrompt,
    buildToolExecutionBatches,
    sanitizeSkillSlug,
    appendRepairLesson,
    OBSERVER_CONTAINER_WORKSPACE_ROOT,
    loopLessonsHostPath
  } = context;

  async function executeObserverRun({
    message,
    sessionId = "Main",
    brain,
    internetEnabled,
    selectedMountIds,
    forceToolUse,
    preset = "autonomous",
    attachments = [],
    runtimeNotesExtra = [],
    taskContext = null,
    abortSignal = null
  }) {
    const outputFilesBefore = await listObserverOutputFiles();
    const outputFilesBeforeMap = new Map(outputFilesBefore.map((file) => [file.fullPath, file]));
    const observerConfig = getObserverConfig();
    const allowedMounts = observerConfig.mounts.filter((mount) => selectedMountIds.includes(mount.id));
    const trackedWorkspaceTargets = collectTrackedWorkspaceTargets(message);
    const trackedWorkspacePaths = [
      ...trackedWorkspaceTargets.hostPaths,
      ...trackedWorkspaceTargets.containerWorkspacePaths
    ];
    const workspaceFilesBefore = await listTrackedWorkspaceFiles(trackedWorkspacePaths);
    const workspaceFilesBeforeMap = new Map(workspaceFilesBefore.map((file) => [file.fullPath, file]));
    const preparedAttachments = await prepareAttachments(attachments);
    const visionImages = brain.specialty === "vision"
      ? await buildVisionImagesFromAttachments(preparedAttachments?.files || [])
      : [];
    const startedAt = Date.now();
    const transcript = [];
    const executedTools = [];
    const successfulToolNames = [];
    const inspectedTargets = new Set();
    const toolLoopSignatures = [];
    const toolLoopDiagnostics = createToolLoopDiagnostics();
    const normalizedTaskContext = taskContext && typeof taskContext === "object"
      ? taskContext
      : {};
    const ollamaLeaseOwnerId = normalizedTaskContext?.taskId
      ? `task:${String(normalizedTaskContext.taskId).trim()}`
      : `session:${String(sessionId || "Main").trim() || "Main"}:worker`;
    let currentOutputSnapshotMap = new Map(outputFilesBeforeMap);
    let currentWorkspaceSnapshotMap = new Map(workspaceFilesBeforeMap);
    let consecutiveNoProgressSteps = 0;
    let consecutiveLowValueSteps = 0;
    let emptyFinalResponseCount = 0;
    let invalidConcreteFinalCount = 0;
    let echoedToolResultsCount = 0;
    let repairContext = null;
    const urlsUsed = [];
    const inspectFirstTarget = extractTaskDirectiveValue(message, "Inspect first:");
    const expectedFirstMove = extractTaskDirectiveValue(message, "Expected first move:");
    const projectRootTargets = extractProjectCycleImplementationRoots(message);
    const requiresConcreteOutcome = Boolean(
      forceToolUse
      || String(preset || "").trim() === "queued-task"
      || /\b(project|repo|repository|code|implement|implementation|refactor|debug|bug|fix|patch|todo|fixme|script)\b/i.test(String(message || ""))
    );
    const mentionsSkillsOrToolbelt = /\b(skill library|skills library|openclaw skills|clawhub|toolbelt|missing tool|missing capability|request tool|request skills?)\b/i.test(String(message || ""));
    const systemPrompt = await buildWorkerSystemPrompt({
      message,
      brain,
      internetEnabled,
      selectedMountIds,
      forceToolUse,
      preset,
      preparedAttachmentsFiles: preparedAttachments?.files || [],
      visionImageCount: visionImages.length,
      runtimeNotesExtra,
      internalJobType: String(normalizedTaskContext?.taskMeta?.internalJobType || normalizedTaskContext?.internalJobType || "").trim()
    });

    const rejectOrRetryInvalidConcreteFinal = (stderr, malformedResponse, feedbackLines) => {
      invalidConcreteFinalCount += 1;
      if (invalidConcreteFinalCount === 1) {
        transcript.push({
          role: "assistant",
          assistant_message: feedbackLines.join(" ")
        });
        return null;
      }
      return {
        ok: false,
        code: 1,
        timedOut: false,
        preset,
        brain,
        forceToolUse,
        network: internetEnabled ? "internet" : "local",
        mounts: allowedMounts,
        attachments: preparedAttachments?.files || [],
        outputFiles: [],
        parsed: null,
        stdout: "",
        stderr,
        malformedResponse: String(malformedResponse || "").slice(0, 4000)
      };
    };

    function buildPermissionApprovalQuestion(permissionApproval = {}) {
      const toolName = compactTaskText(String(permissionApproval.toolName || "").trim(), 120) || "(unknown tool)";
      const reason = compactTaskText(String(permissionApproval.reason || "").trim(), 220)
        || "A permission rule requires your decision before this tool can run.";
      const ruleId = compactTaskText(String(permissionApproval.ruleId || "").trim(), 120);
      const command = compactTaskText(String(permissionApproval.command || "").trim(), 220);
      const targetPath = compactTaskText(String(permissionApproval.path || "").trim(), 200);
      const targetUrl = compactTaskText(String(permissionApproval.url || "").trim(), 200);
      const approvalKey = compactTaskText(String(permissionApproval.key || permissionApproval.scopeKey || "").trim(), 120);
      return [
        "Permission approval required before I can continue.",
        `Tool: ${toolName}`,
        ruleId ? `Rule: ${ruleId}` : "",
        `Reason: ${reason}`,
        command ? `Requested command: ${command}` : "",
        targetPath ? `Target path: ${targetPath}` : "",
        targetUrl ? `Target URL: ${targetUrl}` : "",
        approvalKey ? `Approval key: ${approvalKey}` : "",
        "Reply with exactly one word: approve or deny."
      ].filter(Boolean).join("\n");
    }

    function buildPermissionApprovalTaskMetaUpdates(permissionApproval = {}) {
      const now = Date.now();
      const existingTaskMeta = normalizedTaskContext?.taskMeta && typeof normalizedTaskContext.taskMeta === "object"
        ? normalizedTaskContext.taskMeta
        : {};
      const existingPermissionApprovals = existingTaskMeta?.permissionApprovals && typeof existingTaskMeta.permissionApprovals === "object"
        ? existingTaskMeta.permissionApprovals
        : {};
      const existingHistory = Array.isArray(existingPermissionApprovals.history)
        ? existingPermissionApprovals.history
        : [];
      const requestEntry = {
        type: "request",
        at: now,
        key: String(permissionApproval.key || "").trim(),
        scopeKey: String(permissionApproval.scopeKey || "").trim(),
        ruleId: String(permissionApproval.ruleId || "").trim(),
        toolName: String(permissionApproval.toolName || "").trim(),
        reason: compactTaskText(String(permissionApproval.reason || "").trim(), 220)
      };
      return {
        questionCategory: "permission_rule_approval",
        taskMeta: {
          ...existingTaskMeta,
          permissionApprovals: {
            ...existingPermissionApprovals,
            pending: {
              ...permissionApproval,
              requestedAt: now
            },
            history: [...existingHistory, requestEntry].slice(-120),
            updatedAt: now
          }
        }
      };
    }

    function buildPermissionApprovalWaitingResponse(permissionApproval = {}) {
      const questionForUser = compactTaskText(buildPermissionApprovalQuestion(permissionApproval), 1000);
      const spokenQuestion = annotateNovaSpeechText(
        questionForUser.replace(/\n+/g, " "),
        "question"
      );
      toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
      return {
        ok: true,
        code: 0,
        timedOut: false,
        preset,
        brain,
        forceToolUse,
        network: internetEnabled ? "internet" : "local",
        mounts: allowedMounts.map((mount) => ({
          id: mount.id,
          label: mount.label,
          containerPath: mount.containerPath,
          mode: mount.mode || "ro"
        })),
        attachments: preparedAttachments?.files || [],
        outputFiles: [],
        toolLoopDiagnostics: toolLoopDiagnostics.transportSuccessCount > 0 ? toolLoopDiagnostics : undefined,
        waitingForUser: true,
        questionForUser,
        taskMetaUpdates: buildPermissionApprovalTaskMetaUpdates(permissionApproval),
        parsed: {
          status: "ok",
          result: {
            payloads: [
              {
                text: `${spokenQuestion}\n\nTools used: ${executedTools.join(", ") || "none"}\nMounted paths used: ${allowedMounts.map((mount) => mount.containerPath).join(", ") || "none"}`,
                mediaUrl: null
              }
            ],
            meta: {
              durationMs: Date.now() - startedAt,
              agentMeta: {
                sessionId,
                provider: "ollama",
                model: brain.model
              }
            }
          }
        },
        stdout: questionForUser,
        stderr: ""
      };
    }

    for (let step = 0; step < 8; step += 1) {
      if (abortSignal?.aborted) {
        return {
          ok: false,
          code: 499,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: [],
          parsed: null,
          stdout: "",
          stderr: "task aborted by user",
          aborted: true
        };
      }
      const toolHistory = transcript.length
        ? `\n\nConversation so far:\n${buildTranscriptForPrompt(transcript)}`
        : "";
      const result = await runOllamaPrompt(
        brain.model,
        `${systemPrompt}${toolHistory}\n\nUser request:\n${message}`,
        {
          signal: abortSignal,
          baseUrl: brain.ollamaBaseUrl,
          images: visionImages,
          brainId: brain.id,
          leaseOwnerId: ollamaLeaseOwnerId,
          leaseWaitMs: 15000
        }
      );
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          timedOut: result.timedOut,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: [],
          parsed: null,
          stdout: "",
          stderr: result.stderr || "worker model failed",
          aborted: result.stderr === "task aborted by user"
        };
      }

      let decision;
      try {
        decision = extractJsonObject(result.text);
      } catch (error) {
        const initialRawResponse = String(result.text || "").slice(0, 12000);
        const initialParseError = String(error?.message || "unknown parse error").trim() || "unknown parse error";
        const retried = await retryJsonEnvelope(
          brain.model,
          result.text,
          "Use one of these exact envelopes: {\"assistant_message\":\"...\",\"tool_calls\":[...],\"final\":false} or {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"final\":true}.",
          {
            baseUrl: brain.ollamaBaseUrl,
            brainId: brain.id,
            leaseOwnerId: ollamaLeaseOwnerId,
            leaseWaitMs: 2500
          }
        );
        let debugRetried = { ok: false, text: "", error: "" };
        let retryParseError = "";
        let debugRetryParseError = "";
        if (retried.ok) {
          try {
            decision = extractJsonObject(retried.text);
          } catch (retryError) {
            decision = null;
            retryParseError = String(retryError?.message || "").trim();
          }
        }
        if (!decision) {
          debugRetried = await debugJsonEnvelopeWithPlanner({
            model: brain.model,
            rawText: retried.ok ? retried.text : result.text,
            parseError: retryParseError || initialParseError,
            schemaHint: "Use one of these exact envelopes: {\"assistant_message\":\"...\",\"tool_calls\":[...],\"final\":false} or {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"final\":true}.",
            baseUrl: brain.ollamaBaseUrl,
            leaseOwnerId: ollamaLeaseOwnerId
          });
          if (debugRetried.ok) {
            try {
              decision = extractJsonObject(debugRetried.text);
            } catch (debugRetryError) {
              decision = null;
              debugRetryParseError = String(debugRetryError?.message || "").trim();
            }
          }
        }
        if (!decision) {
          const retryRawResponse = retried.ok ? String(retried.text || "").slice(0, 12000) : "";
          const debugRetryRawResponse = debugRetried.ok ? String(debugRetried.text || "").slice(0, 12000) : "";
          const latestMalformedResponse = debugRetryRawResponse || retryRawResponse || initialRawResponse;
          const finalParseError = debugRetryParseError || retryParseError || initialParseError;
          return {
            ok: false,
            code: 0,
            timedOut: false,
            preset,
            brain,
            forceToolUse,
            network: internetEnabled ? "internet" : "local",
            mounts: allowedMounts,
            attachments: preparedAttachments?.files || [],
            outputFiles: [],
            parsed: null,
            stdout: result.text || "",
            stderr: `worker returned invalid JSON: ${finalParseError}`,
            malformedResponse: latestMalformedResponse,
            initialRawResponse,
            retryRawResponse,
            debugRetryRawResponse,
            finalParseError
          };
        }
      }
      decision = normalizeWorkerDecisionEnvelope(decision);
      if (isEchoedToolResultEnvelope(decision)) {
        echoedToolResultsCount += 1;
        if (echoedToolResultsCount === 1) {
          transcript.push({
            role: "assistant",
            assistant_message: [
              "Your previous response echoed tool results instead of returning an assistant decision.",
              "Do not output role=tool or tool_results as the top-level response.",
              "Return either a non-final assistant tool envelope with tool_calls, or final=true with final_text."
            ].join(" ")
          });
          continue;
        }
        return {
          ok: false,
          code: 1,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: [],
          parsed: null,
          stdout: "",
          stderr: "worker echoed tool results instead of returning an assistant decision",
          malformedResponse: compactTaskText(JSON.stringify(decision), 4000)
        };
      }
      let toolCalls = Array.isArray(decision?.tool_calls) ? decision.tool_calls.map((call, index) => normalizeToolCallRecord(call, index)) : [];
      toolCalls = filterDestructiveWriteCallsForInPlaceEdit(toolCalls, message);
      if (decision?.final || !toolCalls.length) {
        const rawFinalText = normalizeAgentSelfReference(String(decision?.final_text || decision?.assistant_message || "").trim());
        if (!rawFinalText) {
          emptyFinalResponseCount += 1;
          if (emptyFinalResponseCount === 1) {
            transcript.push({
              role: "assistant",
              assistant_message: [
                "Your previous response ended the task without any final_text.",
                "Do not finish with an empty completion.",
                "Either return a non-final tool envelope to keep working, or return final_text that states the completed change or the exact phrase 'no change is possible' with inspected paths."
              ].join(" ")
            });
            continue;
          }
          return {
            ok: false,
            code: 1,
            timedOut: false,
            preset,
            brain,
            forceToolUse,
            network: internetEnabled ? "internet" : "local",
            mounts: allowedMounts,
            attachments: preparedAttachments?.files || [],
            outputFiles: [],
            parsed: null,
            stdout: "",
            stderr: "worker returned an empty final response",
            malformedResponse: compactTaskText(JSON.stringify(decision), 4000)
          };
        }
        emptyFinalResponseCount = 0;
        const finalText = rawFinalText;
        const waitingQuestionMatch = finalText.match(/^\s*QUESTION FOR USER:\s*(.+)$/is);
        const waitingQuestion = compactTaskText(String(waitingQuestionMatch?.[1] || "").trim(), 1000);
        const spokenFinalText = annotateNovaSpeechText(finalText, "reply");
        if (preset !== "internal-recreation" && looksLikeCapabilityRefusalCompletionSummary(finalText)) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker ended with a capability refusal instead of using skill recovery",
            finalText,
            [
              "Your previous final_text was rejected because it refused the task instead of recovering from the missing capability.",
              "Do not say you cannot help just because a needed tool is unavailable.",
              "Search the skill library, inspect the most relevant skill, then use request_skill_installation or request_tool_addition if approval or a new built-in capability is needed."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        const outputFilesAfter = await listObserverOutputFiles();
        const changedOutputFiles = outputFilesAfter.filter((file) => {
          const previous = outputFilesBeforeMap.get(file.fullPath);
          return !previous || previous.modifiedAt !== file.modifiedAt || previous.size !== file.size;
        });
        const workspaceFilesAfter = await listTrackedWorkspaceFiles(trackedWorkspacePaths);
        const changedWorkspaceFiles = workspaceFilesAfter.filter((file) => {
          const previous = workspaceFilesBeforeMap.get(file.fullPath);
          return !previous || previous.modifiedAt !== file.modifiedAt || previous.size !== file.size;
        });
        const isProjectCycleTask = /\/project-todo\.md\b/i.test(String(message || ""))
          || /\bthis is a focused project work package\b/i.test(String(message || ""));
        const objectiveText = extractTaskDirectiveValue(message, "Objective:");
        const minimumConcreteTargets = getProjectNoChangeMinimumTargets();
        const projectCyclePolicy = buildProjectCycleCompletionPolicy(message, {
          minimumConcreteTargets
        });
        const completionState = evaluateProjectCycleCompletionState({
          policy: projectCyclePolicy,
          message,
          finalText,
          inspectedTargets: [...inspectedTargets],
          changedWorkspaceFiles,
          changedOutputFiles,
          successfulToolNames
        });
        const projectRootPath = projectCyclePolicy.projectRootPath;
        const projectTodoPath = projectCyclePolicy.projectTodoPath;
        const usedWriteTool = completionState.usedWriteTool;
        const usedInspectionTool = completionState.usedInspectionTool;
        const hasConcreteFileChange = completionState.hasConcreteFileChange;
        const hasConcreteImplementationInspection = completionState.hasConcreteImplementationInspection;
        const changedConcreteProjectFiles = completionState.changedConcreteProjectFiles;
        const changedImplementationProjectFiles = completionState.changedImplementationProjectFiles;
        const changedProjectTodo = completionState.changedProjectTodo;
        const inspectedExpectedFirstTarget = completionState.inspectedExpectedFirstTarget;
        const hasNoChangeConclusion = completionState.hasNoChangeConclusion;
        const namesInspectedTargets = completionState.namesInspectedTargets;
        const soundsSpeculative = completionState.soundsSpeculative;
        if (waitingQuestion) {
          if (!usedInspectionTool && !hasConcreteFileChange) {
            const retry = rejectOrRetryInvalidConcreteFinal(
              "worker asked a user question without first inspecting the task context",
              finalText,
              [
                "Your previous final_text asked the user a question before grounded inspection.",
                "Inspect the named files or resources first, try a safe repair if possible, and only then ask one focused question if user direction is still required."
              ]
            );
            if (retry) {
              return retry;
            }
            continue;
          }
          if (isProjectCycleTask && requiresConcreteOutcome && !completionState.eligibleForCompletion) {
            const retry = rejectOrRetryInvalidConcreteFinal(
              "worker tried to park a project-cycle task in waiting_for_user before satisfying completion policy",
              finalText,
              [
                "Your previous final_text was rejected because project-cycle work cannot switch to waiting_for_user before the completion policy is satisfied.",
                "Do not ask the user a question as a substitute for the required concrete outcome.",
                "Keep working until you either make the required concrete change and update PROJECT-TODO.md, or provide a valid no-change conclusion with the inspected paths."
              ]
            );
            if (retry) {
              return retry;
            }
            continue;
          }
          invalidConcreteFinalCount = 0;
          toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
          return {
            ok: true,
            code: 0,
            timedOut: false,
            preset,
            brain,
            forceToolUse,
            network: internetEnabled ? "internet" : "local",
            mounts: allowedMounts.map((mount) => ({
              id: mount.id,
              label: mount.label,
              containerPath: mount.containerPath,
              mode: mount.mode || "ro"
            })),
            attachments: preparedAttachments?.files || [],
            outputFiles: changedOutputFiles,
            toolLoopDiagnostics: toolLoopDiagnostics.transportSuccessCount > 0 ? toolLoopDiagnostics : undefined,
            waitingForUser: true,
            questionForUser: waitingQuestion,
            parsed: {
              status: "ok",
              result: {
                payloads: [
                  {
                    text: `${annotateNovaSpeechText(waitingQuestion, "reply")}\n\nAccess used: ${internetEnabled ? "workspace + internet" : "workspace"}\nTools used: ${executedTools.join(", ") || "none"}\nMounted paths used: ${allowedMounts.map((mount) => mount.containerPath).join(", ") || "none"}\nURLs used: ${urlsUsed.join(", ") || "none"}`,
                    mediaUrl: null
                  }
                ],
                meta: {
                  durationMs: Date.now() - startedAt,
                  agentMeta: {
                    sessionId,
                    provider: "ollama",
                    model: brain.model
                  }
                }
              }
            },
            stdout: finalText,
            stderr: ""
          };
        }
        if (preset !== "internal-recreation" && requiresConcreteOutcome && soundsSpeculative) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker claimed completion using speculative or future-tense language",
            finalText,
            [
              "Your previous final_text was rejected because it described intent instead of completed work.",
              "Do not use future tense or recommendations in final_text.",
              "Either keep working with tools, or finish only with completed changes or the exact phrase 'no change is possible' plus inspected paths."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (preset !== "internal-recreation" && requiresConcreteOutcome && !usedInspectionTool && !hasConcreteFileChange) {
          const forcedInspectionTarget = inspectFirstTarget || (projectRootTargets.length ? projectRootTargets[0] : "");
          if (isProjectCycleTask && forcedInspectionTarget && invalidConcreteFinalCount === 0) {
            try {
              const forcedCallId = `forced_inspection_${Date.now()}`;
              const forcedCall = normalizeToolCallRecord({
                id: forcedCallId,
                type: "function",
                function: { name: "read_document", arguments: JSON.stringify({ path: forcedInspectionTarget }) }
              }, 0);
              const forcedResult = await executeWorkerToolCall(forcedCall, { internetEnabled, taskContext: normalizedTaskContext });
              const forcedSemanticOk = isSemanticallySuccessfulToolResult("read_document", forcedResult);
              if (forcedSemanticOk && forcedResult) {
                const formatted = formatToolResultForModel(
                  "read_document",
                  { path: forcedInspectionTarget },
                  String(forcedResult?.stdout || forcedResult?.result || JSON.stringify(forcedResult) || "")
                );
                const compressedForcedResult = { ...forcedResult, __modelFormat: formatted.modelFormat, __density: formatted.density, __findings: formatted.findings };
                inspectedTargets.add(forcedInspectionTarget);
                successfulToolNames.push("read_document");
                transcript.push({
                  role: "assistant",
                  assistant_message: "Previous response rejected: no inspection tools were called. Running the required first inspection now before allowing a final answer."
                });
                transcript.push({
                  role: "assistant",
                  assistant_message: "Reading the required first inspection target.",
                  tool_calls: [forcedCall]
                });
                transcript.push({
                  role: "tool",
                  tool_results: [{
                    tool_call_id: forcedCallId,
                    name: "read_document",
                    ok: true,
                    result: compressedForcedResult
                  }]
                });
                transcript.push({
                  role: "assistant",
                  assistant_message: `File content retrieved. Review the content above, then decide whether to edit the file or inspect additional targets. Do not return final=true until you have made a concrete change or verified no change is possible after inspecting at least ${minimumConcreteTargets} distinct concrete targets.`
                });
                continue;
              }
            } catch {
              // Forced injection failed — fall through to standard rejection
            }
          }
          const missingInspectionGuidance = [];
          if (expectedFirstMove) {
            missingInspectionGuidance.push(`Start with this exact first move: ${expectedFirstMove}`);
          } else if (inspectFirstTarget) {
            missingInspectionGuidance.push(`Start by inspecting this concrete target: ${inspectFirstTarget}`);
          }
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker claimed completion without inspecting concrete files or resources",
            finalText,
            [
              "Your previous final_text was rejected because no concrete inspection was recorded.",
              "Inspect real files, directories, or resources before finishing.",
              ...missingInspectionGuidance,
              "If you still cannot make further progress, inspect the required concrete targets and name them in the no-change conclusion."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && inspectFirstTarget && usedInspectionTool && !inspectedExpectedFirstTarget && !hasConcreteImplementationInspection) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker skipped the named first inspection target before completion",
            finalText,
            [
              "Your previous final_text was rejected because it skipped the named first inspection target without inspecting an equivalent concrete implementation target.",
              `Inspect this target now: ${inspectFirstTarget}`,
              expectedFirstMove || "Keep working with tools after that inspection."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && !hasConcreteImplementationInspection) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker claimed completion without inspecting concrete implementation targets",
            finalText,
            [
              "Your previous final_text was rejected because project-cycle work must inspect concrete implementation targets, not only planning docs or broad listings.",
              expectedFirstMove
                ? `Start with this exact first move: ${expectedFirstMove}`
                : (inspectFirstTarget ? `Inspect this concrete target first: ${inspectFirstTarget}` : "Inspect a concrete implementation file or directory before finishing."),
              "Do not finish until you have inspected a real implementation file, manifest, script, or TODO/FIXME target."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && hasNoChangeConclusion && inspectedTargets.size < minimumConcreteTargets) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            `worker claimed no change was possible without inspecting at least ${minimumConcreteTargets} distinct concrete targets`,
            finalText,
            [
              "Your previous no-change conclusion was rejected because it inspected too little.",
              `For project-cycle work, inspect at least ${minimumConcreteTargets} distinct concrete implementation targets before using that conclusion.`,
              "Keep working with tools, then either make one change or restate the no-change conclusion with the inspected paths."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && hasNoChangeConclusion && !namesInspectedTargets) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker claimed no change was possible without naming the inspected targets",
            finalText,
            [
              "Your previous no-change conclusion was rejected because it did not name the inspected targets.",
              "Name the concrete files or directories you inspected in final_text.",
              "Do not finish again until the inspected targets are explicit."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && hasNoChangeConclusion && objectiveRequiresConcreteImprovement(objectiveText)) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker used a no-change conclusion for an objective that explicitly required a concrete improvement",
            finalText,
            [
              "Your previous no-change conclusion was rejected because the objective explicitly required a concrete improvement.",
              `Objective: ${objectiveText || "make one concrete improvement"}.`,
              "Keep working and either ship one safe concrete change now or provide a verified blocker that explains why the requested improvement is impossible."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && objectiveRequiresConcreteImprovement(objectiveText) && !hasNoChangeConclusion && !changedConcreteProjectFiles.length) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker attempted project-cycle finalization before satisfying completion policy: no concrete project file change was recorded",
            finalText,
            [
              "Your previous final_text was rejected because the objective required a concrete improvement, but the completion policy saw no concrete project file change.",
              `Objective: ${objectiveText || "make one concrete improvement"}.`,
              "Keep working until you change a real project file that advances the objective, then summarize that completed change."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (
          isProjectCycleTask
          && completionState.requiresNonDocumentationArtifact
          && !hasNoChangeConclusion
          && changedConcreteProjectFiles.length
          && !changedImplementationProjectFiles.length
        ) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker attempted project-cycle finalization with documentation-only changes for an implementation objective",
            finalText,
            [
              "Your previous final_text was rejected because the objective pointed at implementation work, but only documentation or planning files changed.",
              `Objective: ${objectiveText || "make one concrete improvement"}.`,
              "Change at least one concrete implementation file that matches the objective, not only README.md, directive.md, or project tracking documents."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (isProjectCycleTask && objectiveRequiresConcreteImprovement(objectiveText) && !hasNoChangeConclusion && projectTodoPath && !changedProjectTodo) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker attempted project-cycle finalization before satisfying completion policy: PROJECT-TODO.md was not updated",
            finalText,
            [
              "Your previous final_text was rejected because project-cycle completion must update PROJECT-TODO.md so the completed work does not get re-queued.",
              `Update this file now: ${projectRootPath}/PROJECT-TODO.md`,
              "Check off the completed objective or rewrite it to reflect the remaining work before finishing."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        if (requiresConcreteOutcome && !usedWriteTool && !changedOutputFiles.length && !changedWorkspaceFiles.length && !hasNoChangeConclusion) {
          const retry = rejectOrRetryInvalidConcreteFinal(
            "worker claimed completion without changing files, producing artifacts, or proving a no-change conclusion",
            finalText,
            [
              "Your previous final_text was rejected because it did not correspond to a file change, artifact, or valid no-change conclusion.",
              "Keep working instead of closing the task from analysis alone.",
              "Your next response should either make a concrete change, produce an artifact, or use the exact phrase 'no change is possible' with the inspected paths."
            ]
          );
          if (retry) {
            return retry;
          }
          continue;
        }
        invalidConcreteFinalCount = 0;
        toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
        if (repairContext && typeof appendRepairLesson === "function") {
          appendRepairLesson(repairContext).catch(() => {});
        }
        return {
          ok: true,
          code: 0,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts.map((mount) => ({
            id: mount.id,
            label: mount.label,
            containerPath: mount.containerPath,
            mode: mount.mode || "ro"
          })),
          attachments: preparedAttachments?.files || [],
          outputFiles: changedOutputFiles,
          toolLoopDiagnostics: toolLoopDiagnostics.transportSuccessCount > 0 ? toolLoopDiagnostics : undefined,
          parsed: {
            status: "ok",
            result: {
              payloads: [
                {
                  text: `${spokenFinalText}\n\nAccess used: ${internetEnabled ? "workspace + internet" : "workspace"}\nTools used: ${executedTools.join(", ") || "none"}\nMounted paths used: ${allowedMounts.map((mount) => mount.containerPath).join(", ") || "none"}\nURLs used: ${urlsUsed.join(", ") || "none"}`,
                  mediaUrl: null
                }
              ],
              meta: {
                durationMs: Date.now() - startedAt,
                agentMeta: {
                  sessionId,
                  provider: "ollama",
                  model: brain.model
                }
              }
            }
          },
          stdout: finalText,
          stderr: ""
        };
      }

      const toolCallSignature = JSON.stringify(
        toolCalls.slice(0, 6).map((toolCall) => ({
          name: String(toolCall?.function?.name || "").trim(),
          arguments: String(toolCall?.function?.arguments || "").trim()
        }))
      );
      toolLoopSignatures.push(toolCallSignature);
      const repeatedSignatureCount = toolLoopSignatures.filter((entry) => entry === toolCallSignature).length;
      if (repeatedSignatureCount === 2) {
        const replanned = await replanRepeatedToolLoopWithPlanner({
          message,
          transcript,
          repeatedToolCallSignature: toolCallSignature,
          executedTools,
          inspectedTargets: [...inspectedTargets],
          baseUrl: brain.ollamaBaseUrl,
          leaseOwnerId: ollamaLeaseOwnerId
        });
        if (!replanned.ok || !replanned.decision) {
          return {
            ok: false,
            code: 1,
            timedOut: false,
            preset,
            brain,
            forceToolUse,
            network: internetEnabled ? "internet" : "local",
            mounts: allowedMounts,
            attachments: preparedAttachments?.files || [],
            outputFiles: [],
            parsed: null,
            stdout: "",
            stderr: `worker repeated the same tool plan and planner ${replanned.plannerBrainId || "fallback-inline"} could not repair it: ${replanned.error || "unknown error"}`,
            malformedResponse: compactTaskText(toolCallSignature, 4000)
          };
        }
        decision = replanned.decision;
        toolCalls = Array.isArray(decision?.tool_calls) ? decision.tool_calls.map((call, index) => normalizeToolCallRecord(call, index)) : [];
        toolCalls = filterDestructiveWriteCallsForInPlaceEdit(toolCalls, message);
        const replannedSignature = JSON.stringify(
          toolCalls.slice(0, 6).map((toolCall) => ({
            name: String(toolCall?.function?.name || "").trim(),
            arguments: String(toolCall?.function?.arguments || "").trim()
          }))
        );
        if (replannedSignature === toolCallSignature) {
          return {
            ok: false,
            code: 1,
            timedOut: false,
            preset,
            brain,
            forceToolUse,
            network: internetEnabled ? "internet" : "local",
            mounts: allowedMounts,
            attachments: preparedAttachments?.files || [],
            outputFiles: [],
            parsed: null,
            stdout: "",
            stderr: "worker repeated the same tool plan and planner returned the same signature again",
            malformedResponse: compactTaskText(replannedSignature, 4000)
          };
        }
        const repeatedCallNames = (() => {
          try {
            return JSON.parse(toolCallSignature).map((c) => String(c?.name || "")).filter(Boolean).join(", ");
          } catch {
            return String(toolCallSignature).slice(0, 120);
          }
        })();
        repairContext = {
          timestamp: new Date().toISOString(),
          taskMessage: message,
          repeatedCalls: repeatedCallNames,
          repairNote: String(replanned.decision?.assistant_message || "").slice(0, 200).trim()
        };
        const containerLessonsPath = OBSERVER_CONTAINER_WORKSPACE_ROOT
          ? `${OBSERVER_CONTAINER_WORKSPACE_ROOT}/prompt-files/LOOP-LESSONS.md`
          : "";
        transcript.push({
          role: "assistant",
          assistant_message: [
            "Loop repair replaced the repeated tool plan with one new next move.",
            containerLessonsPath
              ? `Before marking final, append a one-line lesson to ${containerLessonsPath} describing the pattern that caused the loop and how to avoid it. Format: "- [what you were stuck doing] → [what broke the loop]".`
              : ""
          ].filter(Boolean).join(" ")
        });
      }
      if (repeatedSignatureCount >= 3) {
        return {
          ok: false,
          code: 1,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: [],
          parsed: null,
          stdout: "",
          stderr: `worker repeated the same tool plan without progress (${repeatedSignatureCount} times)`,
          malformedResponse: compactTaskText(toolCallSignature, 4000)
        };
      }

      const toolResults = [];
      let transportSuccessfulToolCount = 0;
      let semanticSuccessfulToolCount = 0;
      const stepInspectionTargets = [];
      const stepNewInspectionTargets = [];
      const stepNewConcreteInspectionTargets = [];

      async function runWithConcurrency(items = [], limit = 1, worker = null) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) {
          return [];
        }
        const maxConcurrency = Math.max(1, Math.min(Number(limit || 1), list.length));
        if (maxConcurrency <= 1) {
          const sequential = [];
          for (const item of list) {
            sequential.push(await worker(item));
          }
          return sequential;
        }
        const results = new Array(list.length);
        let cursor = 0;
        async function consume() {
          while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= list.length) {
              return;
            }
            results[index] = await worker(list[index]);
          }
        }
        await Promise.all(Array.from({ length: maxConcurrency }, () => consume()));
        return results;
      }

      function applyToolOutcome(outcome = {}) {
        const name = String(outcome.name || "").trim();
        if (!name) {
          return;
        }
        if (outcome.transportOk) {
          transportSuccessfulToolCount += 1;
          executedTools.push(name);
        }
        if (name === "web_fetch" && outcome.parsedArgs?.url) {
          urlsUsed.push(String(outcome.parsedArgs.url));
        }
        if (outcome.inspectionTargetKey && ["list_files", "read_document", "read_file", "shell_command", "web_fetch"].includes(name)) {
          stepInspectionTargets.push(outcome.inspectionTargetKey);
          const wasAlreadyInspected = inspectedTargets.has(outcome.inspectionTargetKey);
          inspectedTargets.add(outcome.inspectionTargetKey);
          if (!wasAlreadyInspected) {
            stepNewInspectionTargets.push(outcome.inspectionTargetKey);
            if (isConcreteImplementationInspectionTarget(outcome.inspectionTargetKey, { projectRoots: projectRootTargets })) {
              stepNewConcreteInspectionTargets.push(outcome.inspectionTargetKey);
            }
          }
        }
        if (outcome.semanticOk && name === "request_tool_addition") {
          const requestedTool = compactTaskText(String(outcome.toolResult?.requestedTool || "").replace(/\s+/g, " ").trim(), 120);
          if (requestedTool && !toolLoopDiagnostics.requestedTools.includes(requestedTool)) {
            toolLoopDiagnostics.requestedTools.push(requestedTool);
          }
        }
        if (outcome.semanticOk && name === "request_skill_installation") {
          const requestedSkill = sanitizeSkillSlug(outcome.toolResult?.slug || "");
          if (requestedSkill && !toolLoopDiagnostics.requestedSkills.includes(requestedSkill)) {
            toolLoopDiagnostics.requestedSkills.push(requestedSkill);
          }
        }
        toolResults.push({
          tool_call_id: String(outcome.toolCall?.id || `call_${toolResults.length + 1}`),
          name,
          ok: Boolean(outcome.semanticOk),
          result: outcome.semanticOk ? outcome.compressedResult : undefined,
          error: outcome.semanticOk ? undefined : String(outcome.error || "")
        });
        if (outcome.semanticOk) {
          successfulToolNames.push(name);
          semanticSuccessfulToolCount += 1;
        }
      }

      async function executeSingleToolCall(toolCall) {
        if (abortSignal?.aborted) {
          return { aborted: true };
        }
        const rawName = String(toolCall?.function?.name || "").trim();
        const name = normalizeToolName(rawName) || rawName;
        const parsedArgs = parseToolCallArgs(toolCall);
        try {
          const toolResult = await executeWorkerToolCall(toolCall, {
            internetEnabled,
            taskContext: normalizedTaskContext
          });
          const semanticOk = isSemanticallySuccessfulToolResult(name, toolResult);
          const inspectionTargetKey = semanticOk ? extractInspectionTargetKey(name, parsedArgs) : "";

          let compressedResult = toolResult;
          let semanticError = "";
          if (semanticOk && toolResult) {
            const formatted = formatToolResultForModel(
              name,
              toolCall.function?.arguments || {},
              String(toolResult?.stdout || toolResult?.result || JSON.stringify(toolResult) || "")
            );
            compressedResult = {
              ...toolResult,
              __modelFormat: formatted.modelFormat,
              __density: formatted.density,
              __findings: formatted.findings
            };
          } else if (!semanticOk) {
            semanticError = buildToolSemanticFailureMessage(name, toolResult);
          }

          return {
            toolCall,
            name,
            parsedArgs,
            transportOk: true,
            semanticOk,
            toolResult,
            compressedResult,
            inspectionTargetKey,
            error: semanticError
          };
        } catch (error) {
          const permissionApprovalRequired = error?.permissionApprovalRequired === true
            || String(error?.code || "").trim() === "permission_requires_user_approval";
          if (permissionApprovalRequired) {
            return {
              toolCall,
              name,
              parsedArgs,
              transportOk: false,
              semanticOk: false,
              toolResult: null,
              compressedResult: null,
              inspectionTargetKey: "",
              requiresUserApproval: true,
              permissionApproval: error?.permissionApproval && typeof error.permissionApproval === "object"
                ? { ...error.permissionApproval, toolName: name }
                : { toolName: name, reason: String(error?.message || "").trim() }
            };
          }
          return {
            toolCall,
            name,
            parsedArgs,
            transportOk: false,
            semanticOk: false,
            toolResult: null,
            compressedResult: null,
            inspectionTargetKey: "",
            error: String(error?.message || error || "tool call failed")
          };
        }
      }

      const stepToolCalls = toolCalls.slice(0, 6);
      const rawBatches = typeof buildToolExecutionBatches === "function"
        ? await buildToolExecutionBatches({ toolCalls: stepToolCalls })
        : [];
      const executionBatches = Array.isArray(rawBatches) && rawBatches.length
        ? rawBatches
        : [{ mode: "serial", concurrency: 1, toolCalls: stepToolCalls }];

      for (const batch of executionBatches) {
        const batchToolCalls = Array.isArray(batch?.toolCalls) ? batch.toolCalls.filter(Boolean) : [];
        if (!batchToolCalls.length) {
          continue;
        }
        const mode = String(batch?.mode || "serial").trim().toLowerCase();
        if (mode === "parallel") {
          const concurrency = Math.max(1, Math.min(Number(batch?.concurrency || batchToolCalls.length), 6));
          const outcomes = await runWithConcurrency(batchToolCalls, concurrency, executeSingleToolCall);
          for (const outcome of outcomes) {
            if (outcome?.aborted) {
              return {
                ok: false,
                code: 499,
                timedOut: false,
                preset,
                brain,
                forceToolUse,
                network: internetEnabled ? "internet" : "local",
                mounts: allowedMounts,
                attachments: preparedAttachments?.files || [],
                outputFiles: [],
                parsed: null,
                stdout: "",
                stderr: "task aborted by user",
                aborted: true
              };
            }
            if (outcome?.requiresUserApproval) {
              return buildPermissionApprovalWaitingResponse(outcome.permissionApproval || {});
            }
            applyToolOutcome(outcome);
          }
          continue;
        }
        for (const toolCall of batchToolCalls) {
          const outcome = await executeSingleToolCall(toolCall);
          if (outcome?.aborted) {
            return {
              ok: false,
              code: 499,
              timedOut: false,
              preset,
              brain,
              forceToolUse,
              network: internetEnabled ? "internet" : "local",
              mounts: allowedMounts,
              attachments: preparedAttachments?.files || [],
              outputFiles: [],
              parsed: null,
              stdout: "",
              stderr: "task aborted by user",
              aborted: true
            };
          }
          if (outcome?.requiresUserApproval) {
            return buildPermissionApprovalWaitingResponse(outcome.permissionApproval || {});
          }
          applyToolOutcome(outcome);
        }
      }
      const outputSnapshot = await listObserverOutputFiles();
      const outputDiff = diffFileSnapshots(currentOutputSnapshotMap, outputSnapshot);
      currentOutputSnapshotMap = outputDiff.snapshotMap;
      const workspaceSnapshot = trackedWorkspacePaths.length
        ? await listTrackedWorkspaceFiles(trackedWorkspacePaths)
        : [];
      const workspaceDiff = diffFileSnapshots(currentWorkspaceSnapshotMap, workspaceSnapshot);
      currentWorkspaceSnapshotMap = workspaceDiff.snapshotMap;
      const stepDiagnostics = buildToolLoopStepDiagnostics({
        step: step + 1,
        transportSuccessCount: transportSuccessfulToolCount,
        toolResults,
        inspectionTargets: stepInspectionTargets,
        newInspectionTargets: stepNewInspectionTargets,
        newConcreteInspectionTargets: stepNewConcreteInspectionTargets,
        changedWorkspaceFiles: workspaceDiff.changed,
        changedOutputFiles: outputDiff.changed
      });
      recordToolLoopStepDiagnostics(toolLoopDiagnostics, stepDiagnostics);
      toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);

      if (semanticSuccessfulToolCount === 0) {
        consecutiveNoProgressSteps += 1;
      } else {
        consecutiveNoProgressSteps = 0;
      }
      if (requiresConcreteOutcome || mentionsSkillsOrToolbelt) {
        if (stepDiagnostics.concreteProgress) {
          consecutiveLowValueSteps = 0;
        } else {
          consecutiveLowValueSteps += 1;
        }
      } else {
        consecutiveLowValueSteps = 0;
      }
      if (consecutiveNoProgressSteps >= 3) {
        toolLoopDiagnostics.stopReason = "worker made no semantic tool progress across 3 consecutive steps";
        toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
        return {
          ok: false,
          code: 1,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: [],
          parsed: null,
          stdout: "",
          stderr: buildToolLoopStopMessage(toolLoopDiagnostics.stopReason, toolLoopDiagnostics),
          toolLoopDiagnostics,
          malformedResponse: compactTaskText(JSON.stringify(toolResults), 4000)
        };
      }
      if ((requiresConcreteOutcome || mentionsSkillsOrToolbelt) && consecutiveLowValueSteps >= 3) {
        toolLoopDiagnostics.stopReason = "worker kept using tools without concrete progress across 3 consecutive steps";
        toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
        return {
          ok: false,
          code: 1,
          timedOut: false,
          preset,
          brain,
          forceToolUse,
          network: internetEnabled ? "internet" : "local",
          mounts: allowedMounts,
          attachments: preparedAttachments?.files || [],
          outputFiles: outputDiff.changed,
          parsed: null,
          stdout: "",
          stderr: buildToolLoopStopMessage(toolLoopDiagnostics.stopReason, toolLoopDiagnostics),
          toolLoopDiagnostics,
          malformedResponse: compactTaskText(JSON.stringify(toolResults), 4000)
        };
      }

      transcript.push({
        assistant_message: String(decision.assistant_message || "").trim(),
        tool_calls: toolCalls
      });
      transcript.push({
        role: "tool",
        tool_results: toolResults
      });
      transcript.push({
        role: "assistant",
        assistant_message: buildPostToolDecisionInstruction(toolResults, {
          inspectFirstTarget,
          expectedFirstMove,
          stepDiagnostics,
          lowValueStreak: consecutiveLowValueSteps,
          requireConcreteConvergence: requiresConcreteOutcome,
          mentionsSkillsOrToolbelt
        })
      });
    }

    toolLoopDiagnostics.stopReason = "worker exceeded the tool loop cap";
    toolLoopDiagnostics.summary = buildToolLoopSummaryText(toolLoopDiagnostics);
    return {
      ok: false,
      code: 1,
      timedOut: false,
      preset,
      brain,
      forceToolUse,
      network: internetEnabled ? "internet" : "local",
      mounts: allowedMounts,
      attachments: preparedAttachments?.files || [],
      outputFiles: [],
      parsed: null,
      stdout: "",
      stderr: buildToolLoopStopMessage(toolLoopDiagnostics.stopReason, toolLoopDiagnostics),
      toolLoopDiagnostics
    };
  }

  return {
    executeObserverRun
  };
}
