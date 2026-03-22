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
    getObserverConfig,
    getProjectNoChangeMinimumTargets,
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
    sanitizeSkillSlug
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
    let currentOutputSnapshotMap = new Map(outputFilesBeforeMap);
    let currentWorkspaceSnapshotMap = new Map(workspaceFilesBeforeMap);
    let consecutiveNoProgressSteps = 0;
    let consecutiveLowValueSteps = 0;
    let emptyFinalResponseCount = 0;
    let invalidConcreteFinalCount = 0;
    let echoedToolResultsCount = 0;
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
      runtimeNotesExtra
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
        { signal: abortSignal, baseUrl: brain.ollamaBaseUrl, images: visionImages }
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
        const retried = await retryJsonEnvelope(
          brain.model,
          result.text,
          "Use one of these exact envelopes: {\"assistant_message\":\"...\",\"tool_calls\":[...],\"final\":false} or {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"final\":true}.",
          { baseUrl: brain.ollamaBaseUrl }
        );
        let debugRetried = { ok: false, text: "", error: "" };
        if (retried.ok) {
          try {
            decision = extractJsonObject(retried.text);
          } catch {
            decision = null;
          }
        }
        if (!decision) {
          debugRetried = await debugJsonEnvelopeWithPlanner({
            model: brain.model,
            rawText: retried.ok ? retried.text : result.text,
            parseError: error.message,
            schemaHint: "Use one of these exact envelopes: {\"assistant_message\":\"...\",\"tool_calls\":[...],\"final\":false} or {\"assistant_message\":\"...\",\"final_text\":\"...\",\"tool_calls\":[],\"final\":true}.",
            baseUrl: brain.ollamaBaseUrl
          });
          if (debugRetried.ok) {
            try {
              decision = extractJsonObject(debugRetried.text);
            } catch {
              decision = null;
            }
          }
        }
        if (!decision) {
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
            stderr: `worker returned invalid JSON: ${error.message}`,
            malformedResponse: String((debugRetried.ok ? debugRetried.text : retried.ok ? retried.text : result.text) || "").slice(0, 12000)
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
        if (looksLikeCapabilityRefusalCompletionSummary(finalText)) {
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
        if (requiresConcreteOutcome && soundsSpeculative) {
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
        if (requiresConcreteOutcome && !usedInspectionTool && !hasConcreteFileChange) {
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
          baseUrl: brain.ollamaBaseUrl
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
        transcript.push({
          role: "assistant",
          assistant_message: "Loop repair replaced the repeated tool plan with one new next move."
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
      for (const toolCall of toolCalls.slice(0, 6)) {
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
        const rawName = String(toolCall?.function?.name || "").trim();
        const name = normalizeToolName(rawName) || rawName;
        try {
          const toolResult = await executeWorkerToolCall(toolCall, { internetEnabled });
          transportSuccessfulToolCount += 1;
          executedTools.push(name);
          const parsedArgs = parseToolCallArgs(toolCall);
          if (name === "web_fetch" && parsedArgs.url) {
            urlsUsed.push(String(parsedArgs.url));
          }
          const semanticOk = isSemanticallySuccessfulToolResult(name, toolResult);
          const inspectionTargetKey = semanticOk ? extractInspectionTargetKey(name, parsedArgs) : "";
          if (inspectionTargetKey && ["list_files", "read_document", "read_file", "shell_command", "web_fetch"].includes(name)) {
            stepInspectionTargets.push(inspectionTargetKey);
            const wasAlreadyInspected = inspectedTargets.has(inspectionTargetKey);
            inspectedTargets.add(inspectionTargetKey);
            if (!wasAlreadyInspected) {
              stepNewInspectionTargets.push(inspectionTargetKey);
              if (isConcreteImplementationInspectionTarget(inspectionTargetKey, { projectRoots: projectRootTargets })) {
                stepNewConcreteInspectionTargets.push(inspectionTargetKey);
              }
            }
          }
          if (semanticOk && name === "request_tool_addition") {
            const requestedTool = compactTaskText(String(toolResult?.requestedTool || "").replace(/\s+/g, " ").trim(), 120);
            if (requestedTool && !toolLoopDiagnostics.requestedTools.includes(requestedTool)) {
              toolLoopDiagnostics.requestedTools.push(requestedTool);
            }
          }
          if (semanticOk && name === "request_skill_installation") {
            const requestedSkill = sanitizeSkillSlug(toolResult?.slug || "");
            if (requestedSkill && !toolLoopDiagnostics.requestedSkills.includes(requestedSkill)) {
              toolLoopDiagnostics.requestedSkills.push(requestedSkill);
            }
          }
          toolResults.push({
            tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
            name,
            ok: semanticOk,
            result: semanticOk ? toolResult : undefined,
            error: semanticOk ? undefined : buildToolSemanticFailureMessage(name, toolResult)
          });
          if (semanticOk) {
            successfulToolNames.push(name);
            semanticSuccessfulToolCount += 1;
          }
        } catch (error) {
          toolResults.push({
            tool_call_id: String(toolCall.id || `call_${toolResults.length + 1}`),
            name,
            ok: false,
            error: error.message
          });
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
