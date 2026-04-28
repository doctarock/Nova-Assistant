import path from "path";

export function buildRegressionSuiteDefinitions({ outputRoot = "" } = {}) {
  return [
    {
      id: "intake",
      label: "Intake Immediate",
      description: "Verify prompts that should be handled immediately by the native observer path.",
      cases: [
        {
          id: "time",
          label: "Time request",
          kind: "intake",
          prompt: "what is the time",
          expectedType: "time"
        },
        {
          id: "date",
          label: "Date request",
          kind: "intake",
          prompt: "what is the date",
          expectedType: "date"
        },
        {
          id: "queue-status",
          label: "Queue status",
          kind: "intake",
          prompt: "what's in the queue",
          expectedType: "queue_status"
        },
        {
          id: "activity-summary-completed",
          label: "Completed-today summary",
          kind: "intake",
          prompt: "what work has been completed today",
          expectedType: "activity_summary"
        },
        {
          id: "activity-summary-work",
          label: "Work summary",
          kind: "intake",
          prompt: "work summary",
          expectedType: "activity_summary"
        },
        {
          id: "activity-summary-up-to",
          label: "What have you been up to",
          kind: "intake",
          prompt: "what have you been up to",
          expectedType: "activity_summary"
        },
        {
          id: "mail-status",
          label: "Mail status",
          kind: "intake",
          prompt: "mail status",
          expectedType: "mail_status"
        },
        {
          id: "inbox-summary",
          label: "Inbox summary",
          kind: "intake",
          prompt: "inbox summary",
          expectedType: "inbox_summary"
        },
        {
          id: "todays-emails",
          label: "Today's emails",
          kind: "intake",
          prompt: "today's emails",
          expectedType: "inbox_summary"
        },
        {
          id: "output-status",
          label: "Output status",
          kind: "intake",
          prompt: "what files did you create",
          expectedType: "output_status"
        },
        {
          id: "completion-summary",
          label: "Completion summary",
          kind: "intake",
          prompt: "what did you finish",
          expectedType: "completion_summary"
        },
        {
          id: "failure-summary",
          label: "Failure summary",
          kind: "intake",
          prompt: "what failed",
          expectedType: "failure_summary"
        },
        {
          id: "document-overview",
          label: "Document overview",
          kind: "intake",
          prompt: "document overview",
          expectedType: "document_overview"
        },
        {
          id: "document-search",
          label: "Document search",
          kind: "intake",
          prompt: "search documents for sharepoint",
          expectedType: "document_search"
        },
        {
          id: "daily-briefing",
          label: "Daily briefing",
          kind: "intake",
          prompt: "daily briefing",
          expectedType: "daily_briefing"
        },
        {
          id: "installed-skills",
          label: "Installed skills",
          kind: "intake",
          prompt: "what skills do you have",
          expectedType: "installed_skills"
        },
        {
          id: "skill-search",
          label: "Skill search",
          kind: "intake",
          prompt: "find skills for mail automation",
          expectedType: "skill_search"
        },
      ]
    },
    {
      id: "planner",
      label: "Planner",
      description: "Verify CPU intake planning chooses the right action and produces usable task shapes.",
      cases: [
        {
          id: "reply-only-advice",
          label: "Reply-only advice",
          kind: "planner",
          prompt: "help me phrase a short update about today's progress",
          expectedAction: "reply_only"
        },
        {
          id: "reply-only-titles",
          label: "Reply-only titles",
          kind: "planner",
          prompt: "give me three better titles for heartbeat-status-update.md",
          expectedAction: "reply_only"
        },
        {
          id: "reply-only-structure",
          label: "Reply-only structure advice",
          kind: "planner",
          prompt: "how should I structure a regression checklist for workers",
          expectedAction: "reply_only"
        },
        {
          id: "reply-only-next-step",
          label: "Reply-only next step",
          kind: "planner",
          prompt: "what would be a good next step after making intake and worker checklists",
          expectedAction: "reply_only"
        },
        {
          id: "enqueue-file-summary",
          label: "Enqueue file summary",
          kind: "planner",
          prompt: "read E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md and write a short risk summary",
          expectedAction: "enqueue",
          requireShapedTask: true
        },
        {
          id: "enqueue-checklist-merge",
          label: "Enqueue checklist merge",
          kind: "planner",
          prompt: "compare the intake and worker regression checklists and create a merged operator version",
          expectedAction: "enqueue",
          requireShapedTask: true
        },
        {
          id: "enqueue-failed-tasks-review",
          label: "Enqueue failed task review",
          kind: "planner",
          prompt: "inspect recent failed tasks and identify the top three recurring causes",
          expectedAction: "enqueue",
          requireShapedTask: true
        },
        {
          id: "enqueue-stale-reports",
          label: "Enqueue stale reports review",
          kind: "planner",
          prompt: "look through observer-output and find stale reports that should be consolidated",
          expectedAction: "enqueue",
          requireShapedTask: true
        },
        {
          id: "cadence-every-15m",
          label: "Cadence preservation",
          kind: "planner",
          prompt: "every 15m check for missing profile details and ask one focused question",
          expectedAction: "enqueue",
          expectedEvery: "15m"
        },
        {
          id: "delay-in-5m",
          label: "Delay preservation",
          kind: "planner",
          prompt: "in 5m inspect the completed queue for vague summaries",
          expectedAction: "enqueue",
          expectedDelay: "5m"
        },
        {
          id: "cadence-every-2h",
          label: "Cadence 2h",
          kind: "planner",
          prompt: "every 2h review failed tasks and group them by root cause",
          expectedAction: "enqueue",
          expectedEvery: "2h"
        }
      ]
    },
    {
      id: "worker",
      label: "Local Worker",
      description: "Verify the local tool-using worker can complete grounded tasks with concrete outcomes.",
      requiresIdleWorkerLane: true,
      cases: [
        {
          id: "write-glumgame-summary",
          label: "Write project summary",
          kind: "worker",
          prompt: "Read \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\" and write a concise project summary to \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\glumgame-summary.md\"",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "glumgame-summary.md")
        },
        {
          id: "rewrite-intake-checklist",
          label: "Rewrite intake checklist",
          kind: "worker",
          prompt: "Read \"E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md\" and rewrite it as a short numbered operator checklist in \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\intake-operator-checklist.md\"",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "intake-operator-checklist.md")
        },
        {
          id: "heartbeat-vs-intake",
          label: "Heartbeat vs intake diff",
          kind: "worker",
          prompt: "Compare \"E:\\AI\\derpy-claw\\observer-output\\heartbeat-status-update.md\" with \"E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md\" and write a short differences note to \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\heartbeat-vs-intake.md\"",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "heartbeat-vs-intake.md")
        },
        {
          id: "glumgame-next-actions",
          label: "GlumGame next actions",
          kind: "worker",
          prompt: "Inspect \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\" and extract a bullet list of concrete next actions into \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\glumgame-next-actions.md\"",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "glumgame-next-actions.md")
        },
        {
          id: "no-change-proof",
          label: "No-change proof",
          kind: "worker",
          prompt: "Inspect these three files and tell me whether there is an obvious safe formatting-only improvement without making changes. Name each inspected target in your conclusion: \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\", \"E:\\AI\\derpy-claw\\observer-output\\heartbeat-status-update.md\", \"E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md\"",
          expectedNamedTargets: [
            "readme.md",
            "heartbeat-status-update.md",
            "intake-immediate-regression-checklist.md"
          ]
        },
        {
          id: "no-change-duplicates",
          label: "No-change duplicate-section proof",
          kind: "worker",
          prompt: "Inspect these three files and tell me whether any safe duplicate section can be removed without editing anything yet. Name all three inspected files in the conclusion: \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\", \"E:\\AI\\derpy-claw\\observer-output\\heartbeat-status-update.md\", \"E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md\"",
          expectedNamedTargets: [
            "readme.md",
            "heartbeat-status-update.md",
            "intake-immediate-regression-checklist.md"
          ]
        },
        {
          id: "status-note",
          label: "Status note output",
          kind: "worker",
          prompt: "Read \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\" and produce a one-paragraph status note in \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\status-note.md\". The completion message must mention the file written.",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "status-note.md"),
          expectedSummaryIncludes: [
            "status-note.md"
          ]
        },
        {
          id: "completed-today-template",
          label: "Completed-today template",
          kind: "worker",
          prompt: "Create \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\completed-today-template.md\" with a short reusable template for reporting completed work today.",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "completed-today-template.md"),
          expectedSummaryIncludes: [
            "completed-today-template.md"
          ]
        },
        {
          id: "edit-existing-file",
          label: "Edit existing file",
          kind: "worker",
          prompt: "Edit \"observer-output/worker-regression/edit-canary.md\" by replacing \"Status: TODO\" with \"Status: DONE\" and replacing \"Owner: unassigned\" with \"Owner: worker\". Keep the rest of the file unchanged and mention the edited file in the completion message.",
          seedFiles: [
            {
              path: path.join(outputRoot, "worker-regression", "edit-canary.md"),
              content: [
                "# Edit Canary",
                "",
                "Status: TODO",
                "Owner: unassigned",
                "Notes: preserve this line"
              ].join("\n")
            }
          ],
          expectedContentPath: path.join(outputRoot, "worker-regression", "edit-canary.md"),
          expectedFileIncludes: [
            "Status: DONE",
            "Owner: worker",
            "Notes: preserve this line"
          ],
          expectedSummaryIncludes: [
            "edit-canary.md"
          ]
        },
        {
          id: "creative-handoff-scene-revision",
          label: "Creative handoff scene revision",
          kind: "worker",
          prompt: "Revise the scene in \"observer-output/worker-regression/story-canary.md\" so it feels more atmospheric and emotionally specific while preserving the facts that Mira arrives at the station with a brass key and checks the old clock. Edit the file in place, keep the title and heading, and mention the edited file in the completion message.",
          seedFiles: [
            {
              path: path.join(outputRoot, "worker-regression", "story-canary.md"),
              content: [
                "# Story Canary",
                "",
                "## Scene",
                "Mira arrived at the station with a brass key in her hand. She looked at the old clock and felt nervous."
              ].join("\n")
            }
          ],
          expectedContentPath: path.join(outputRoot, "worker-regression", "story-canary.md"),
          expectedFileIncludes: [
            "# Story Canary",
            "## Scene",
            "Mira",
            "brass key",
            "clock"
          ],
          expectedFileExcludes: [
            "Mira arrived at the station with a brass key in her hand. She looked at the old clock and felt nervous."
          ],
          expectedSummaryIncludes: [
            "story-canary.md"
          ],
          expectedTaskFields: {
            creativeHandoffBrainId: "creative_worker"
          }
        },
        {
          id: "worker-regression-index",
          label: "Worker regression index",
          kind: "worker",
          prompt: "Inspect \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\" and write an index file called \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\index.md\" listing the files you found.",
          expectedOutputPath: path.join(outputRoot, "worker-regression", "index.md"),
          expectedSummaryIncludes: [
            "index.md"
          ]
        }
      ]
    },
    {
      id: "tool-loop-repair",
      label: "Tool Loop Repair",
      description: "Verify the planner repair path replaces repeated tool plans with a different concrete next move.",
      cases: [
        {
          id: "project-todo-reread",
          label: "Project TODO reread repair",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Advance the project GlumGame-project in /home/openclaw/.observer-sandbox/workspace/GlumGame-project. Start by reviewing /home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md and then move to concrete implementation files.",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md\"}"
            }
          ],
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md"
          ],
          executedTools: [
            "read_document"
          ],
          expectedFirstToolName: "list_files",
          expectedFirstToolTarget: "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input"
        },
        {
          id: "project-root-relist",
          label: "Project root relist repair",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Advance the project Starforge-novel-project in /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project. Review the plan once, then inspect concrete manuscript files and make one improvement.",
          repeatedToolCalls: [
            {
              name: "list_files",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project\"}"
            }
          ],
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project"
          ],
          executedTools: [
            "list_files"
          ],
          expectedFirstToolName: "list_files",
          expectedFirstToolTarget: "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input"
        },
        {
          id: "project-startup-bundle-repeat",
          label: "Project startup bundle repeat repair",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Advance the project GlumGame-project in /home/openclaw/.observer-sandbox/workspace/GlumGame-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Tighten validation and user feedback in `observer-input/app.js`.\nProject root: /home/openclaw/.observer-sandbox/workspace/GlumGame-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js\nInspect second if needed: /home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/README.md\nInspect third if needed: /home/openclaw/.observer-sandbox/workspace/GlumGame-project/readme.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js before deciding on further edits.",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md\"}"
            },
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-ROLE-TASKS.md\"}"
            },
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js\"}"
            }
          ],
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-ROLE-TASKS.md",
            "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js"
          ],
          executedTools: [
            "read_document"
          ],
          expectedFirstToolName: "read_document",
          expectedFirstToolTarget: "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/README.md"
        },
        {
          id: "project-startup-bundle-repeat-without-follow-up-hint",
          label: "Project startup bundle fallback repair",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits.",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\"}"
            },
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md\"}"
            },
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md\"}"
            }
          ],
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md",
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md"
          ],
          executedTools: [
            "read_document"
          ],
          expectedFirstToolName: "list_files",
          expectedFirstToolTarget: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
        },
        {
          id: "project-missing-first-target-advances",
          label: "Project missing first target advances",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Advance the project smart-forms-pro-0.4.0-src in /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src.\nThis is a focused project work package, not a full project sweep.\nObjective: Create README.md that explains the project purpose, WordPress setup, and current status.\nProject root: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src.\nInspect first: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/readme.md\nInspect second if needed: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/smart-forms-pro.php\nInspect third if needed: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/includes/class-sfp-plugin.php\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/readme.md before deciding on further edits.",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/readme.md\"}"
            }
          ],
          inspectedTargets: [],
          executedTools: [
            "read_document"
          ],
          expectedFirstToolName: "read_document",
          expectedFirstToolTarget: "/home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/smart-forms-pro.php"
        },
        {
          id: "grounded-summary-read-write-repeat",
          label: "Grounded summary read/write repeat repair",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Read \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\" and write a concise project summary to \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\glumgame-summary.md\"",
          repeatedToolCalls: [
            {
              name: "read_file",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\GlumGame-project\\\\readme.md\"}"
            },
            {
              name: "write_file",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\worker-regression\\\\glumgame-summary.md\"}"
            }
          ],
          inspectedTargets: [
            "E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md"
          ],
          executedTools: [
            "read_file",
            "write_file"
          ],
          expectedFirstToolName: "read_document",
          expectedFirstToolTarget: "E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md"
        },
        {
          id: "grounded-single-read-repeat-switches-tool",
          label: "Grounded single-read repeat switches tool",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Read \"E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md\" and write a concise project summary to \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\glumgame-summary.md\"\n\nRetry note: the previous worker repeated the same tool plan without advancing the work.\nMove to a different concrete file, directory, or edit step instead of repeating the same inspection loop.",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\GlumGame-project\\\\readme.md\"}"
            }
          ],
          inspectedTargets: [
            "E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md"
          ],
          executedTools: [
            "read_document"
          ],
          expectedFirstToolName: "read_file",
          expectedFirstToolTarget: "E:\\AI\\derpy-claw\\observer-output\\GlumGame-project\\readme.md"
        },
        {
          id: "grounded-compare-repeat-advances-second-source",
          label: "Grounded compare repeat advances second source",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Compare \"E:\\AI\\derpy-claw\\observer-output\\heartbeat-status-update.md\" with \"E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md\" and write a short differences note to \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\heartbeat-vs-intake.md\"",
          repeatedToolCalls: [
            {
              name: "read_document",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\heartbeat-status-update.md\"}"
            },
            {
              name: "write_file",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\worker-regression\\\\heartbeat-vs-intake.md\"}"
            }
          ],
          inspectedTargets: [
            "E:\\AI\\derpy-claw\\observer-output\\heartbeat-status-update.md"
          ],
          executedTools: [
            "read_document",
            "write_file"
          ],
          expectedFirstToolName: "read_document",
          expectedFirstToolTarget: "E:\\AI\\derpy-claw\\observer-output\\intake-immediate-regression-checklist.md"
        },
        {
          id: "grounded-directory-index-repeat-expands-listing",
          label: "Grounded directory index repeat expands listing",
          kind: "internal",
          mode: "tool_loop_repair",
          prompt: "Inspect \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\" and write an index file called \"E:\\AI\\derpy-claw\\observer-output\\worker-regression\\index.md\" listing the files you found.",
          repeatedToolCalls: [
            {
              name: "list_files",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\worker-regression\"}"
            },
            {
              name: "write_file",
              arguments: "{\"path\":\"E:\\\\AI\\\\derpy-claw\\\\observer-output\\\\worker-regression\\\\index.md\"}"
            }
          ],
          inspectedTargets: [
            "E:\\AI\\derpy-claw\\observer-output\\worker-regression"
          ],
          executedTools: [
            "list_files",
            "write_file"
          ],
          expectedFirstToolName: "list_files",
          expectedFirstToolTarget: "E:\\AI\\derpy-claw\\observer-output\\worker-regression"
        }
      ]
    },
    {
      id: "skill-library-pipeline",
      label: "Skill Library Pipeline",
      description: "Verify skill retrieval failures surface clearly and live sandboxed search, inspect, install, and listing all work end-to-end.",
      cases: [
        {
          id: "skill-command-failure-surfaces",
          label: "Skill command failure surfaces",
          kind: "internal",
          mode: "skill_library_command_failure",
          result: {
            code: 1,
            stderr: "npm error code ENOENT"
          },
          action: "skill library search",
          expectedMessageIncludes: "skill library search failed: npm error code ENOENT"
        },
        {
          id: "skill-search-inspect-install-list",
          label: "Skill search, inspect, install, and list",
          kind: "internal",
          mode: "skill_library_pipeline",
          query: "browser automation",
          limit: 5,
          minResults: 1,
          expectedSearchSlugIncludes: [
            "browser-automation"
          ],
          expectedInspectFields: [
            "slug",
            "name",
            "summary"
          ],
          expectedInstalledFields: [
            "slug",
            "name",
            "description",
            "skillPath"
          ]
        },
        {
          id: "skill-approval-persists-across-reload",
          label: "Skill approval persists across reload",
          kind: "internal",
          mode: "skill_approval_persistence",
          skillSlug: "browser-automation",
          skillName: "browser",
          skillDescription: "browser automation skill"
        }
      ]
    },
    {
      id: "project-cycle-pipeline",
      label: "Project-Cycle Pipeline",
      description: "Verify retry, escalation, classification, and inspection guardrails for project-cycle execution.",
      cases: [
        {
          id: "classify-no-change-targets",
          label: "Classify no-change target failure",
          kind: "internal",
          mode: "failure_classification",
          failureText: "worker claimed no change was possible without naming the inspected targets",
          expectedClassification: "no_change_missing_targets"
        },
        {
          id: "classify-invalid-envelope",
          label: "Classify echoed tool envelope failure",
          kind: "internal",
          mode: "failure_classification",
          failureText: "worker echoed tool results instead of returning an assistant decision",
          expectedClassification: "invalid_envelope"
        },
        {
          id: "classify-low-value-tool-loop",
          label: "Classify low-value tool loop failure",
          kind: "internal",
          mode: "failure_classification",
          failureText: "worker kept using tools without concrete progress across 3 consecutive steps: 9 transport-ok tool calls, 7 semantically successful, 4 inspection-only steps, 0 workspace writes, 0 artifact outputs, 0 capability requests.",
          expectedClassification: "low_value_tool_loop"
        },
        {
          id: "classify-project-missing-concrete-change",
          label: "Classify project missing concrete change failure",
          kind: "internal",
          mode: "failure_classification",
          failureText: "worker attempted project-cycle finalization before satisfying completion policy: no concrete project file change was recorded",
          expectedClassification: "project_missing_concrete_change"
        },
        {
          id: "classify-project-missing-todo-update",
          label: "Classify project missing todo update failure",
          kind: "internal",
          mode: "failure_classification",
          failureText: "worker attempted project-cycle finalization before satisfying completion policy: PROJECT-TODO.md was not updated",
          expectedClassification: "project_missing_todo_update"
        },
        {
          id: "repair-json-envelope-missing-arguments-brace",
          label: "Repair JSON envelope with missing tool arguments brace",
          kind: "internal",
          mode: "json_envelope_repair",
          responseText: '{"tool_calls":[{"name":"write_file","arguments":{"path":"/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md","content":"# simple-check-project\\n\\n## Purpose\\nA minimal project."},"id":"call_3","type":"function"},{"name":"edit_file","arguments":{"path":"/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md","content":"# Project Todo\\n- [x] README updated."},"id":"call_4","type":"function"},{"name":"edit_file","arguments":{"path":"/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md","content":"# Project Role Tasks\\n## Project Manager\\n- [ ] Keep planning files aligned.","id":"call_5","type":"function"}]}',
          expectedToolCallCount: 3,
          expectedToolNames: ["write_file", "edit_file", "edit_file"]
        },
        {
          id: "repair-json-envelope-missing-tool-call-brace",
          label: "Repair JSON envelope with missing tool call brace",
          kind: "internal",
          mode: "json_envelope_repair",
          responseText: '{"assistant_message":"Retrying README.md read with corrected tool arguments.","tool_calls":[{"id":"call_2","type":"function","function":{"name":"read_document","arguments":"{\\"path\\":\\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md\\"}"}]}',
          expectedToolCallCount: 1,
          expectedToolNames: ["read_document"]
        },
        {
          id: "repair-json-envelope-bare-path-arguments",
          label: "Repair JSON envelope with bare path arguments",
          kind: "internal",
          mode: "json_envelope_repair",
          responseText: '[{"name":"read_document","arguments":"/home/openclaw/.observer-sandbox/workspace/ScifiNovel/directive.md"}]',
          expectedToolCallCount: 1,
          expectedToolNames: ["read_document"]
        },
        {
          id: "repair-json-envelope-key-value-arguments",
          label: "Repair JSON envelope with key value arguments",
          kind: "internal",
          mode: "json_envelope_repair",
          responseText: '[{"name":"read_file","arguments":"path=/home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/README.md"}]',
          expectedToolCallCount: 1,
          expectedToolNames: ["read_file"]
        },
        {
          id: "tool-loop-step-exploration",
          label: "Tool loop step marks exploration",
          kind: "internal",
          mode: "tool_loop_step_diagnostics",
          toolResults: [
            { name: "read_document", ok: true, result: { path: "/home/openclaw/.observer-sandbox/workspace/Example/PROJECT-TODO.md" } },
            { name: "list_files", ok: true, result: { root: "/home/openclaw/.observer-sandbox/workspace/Example" } }
          ],
          inspectionTargets: [
            "/home/openclaw/.observer-sandbox/workspace/Example/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/Example"
          ],
          newInspectionTargets: [
            "/home/openclaw/.observer-sandbox/workspace/Example/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/Example"
          ],
          newConcreteInspectionTargets: [],
          changedWorkspaceFiles: [],
          changedOutputFiles: [],
          expected: {
            progressKind: "exploration",
            concreteProgress: false,
            inspectionOnly: true
          }
        },
        {
          id: "tool-loop-step-capability-request",
          label: "Tool loop step marks capability request progress",
          kind: "internal",
          mode: "tool_loop_step_diagnostics",
          toolResults: [
            { name: "request_tool_addition", ok: true, result: { requestedTool: "browser_automation" } }
          ],
          inspectionTargets: [],
          newInspectionTargets: [],
          newConcreteInspectionTargets: [],
          changedWorkspaceFiles: [],
          changedOutputFiles: [],
          expected: {
            progressKind: "capability_request",
            concreteProgress: true,
            inspectionOnly: false
          }
        },
        {
          id: "tool-loop-stop-message",
          label: "Tool loop stop message includes diagnosis",
          kind: "internal",
          mode: "tool_loop_stop_message",
          reason: "worker exceeded the tool loop cap",
          diagnostics: {
            transportSuccessCount: 12,
            semanticSuccessCount: 9,
            inspectionOnlyStepCount: 4,
            workspaceChangeCount: 0,
            outputArtifactCount: 0,
            toolRequestCount: 1,
            uniqueConcreteInspectionTargets: ["/home/openclaw/.observer-sandbox/workspace/Example/src/app.js"],
            toolUsage: {
              read_document: 7,
              list_files: 3,
              shell_command: 2
            }
          },
          mustInclude: [
            "worker exceeded the tool loop cap",
            "12 transport-ok tool calls",
            "1 capability request",
            "Top tools: read_document x7, list_files x3, shell_command x2",
            "never converged to an edit, artifact, capability request, or valid no-change conclusion"
          ]
        },
        {
          id: "project-config-normalization",
          label: "Project config normalization",
          kind: "internal",
          mode: "project_config",
          input: {
            maxActiveWorkPackagesPerProject: 99,
            projectWorkRetryCooldownMs: -1,
            opportunityScanIdleMs: 1000,
            opportunityScanIntervalMs: 5000,
            opportunityScanRetentionMs: 0,
            opportunityScanMaxQueuedBacklog: 0,
            noChangeMinimumConcreteTargets: 99,
            creativeThroughputMode: "warp",
            autoImportProjects: false
          },
          expected: {
            maxActiveWorkPackagesPerProject: 12,
            projectWorkRetryCooldownMs: 0,
            opportunityScanIdleMs: 5000,
            opportunityScanIntervalMs: 10000,
            opportunityScanRetentionMs: 3600000,
            opportunityScanMaxQueuedBacklog: 1,
            noChangeMinimumConcreteTargets: 6,
            creativeThroughputMode: "auto",
            autoImportProjects: false
          }
        },
        {
          id: "retry-meta-preserves-creative-throughput-flags",
          label: "Retry metadata preserves creative throughput flags",
          kind: "internal",
          mode: "retry_meta",
          task: {
            creativeThroughputMode: "auto",
            preferHigherThroughputCreativeLane: true,
            skipCreativeHandoff: true,
            projectWorkPrimaryTarget: "Act-II-Draft.md",
            projectWorkSecondaryTarget: "Act-I-Draft.md",
            projectWorkTertiaryTarget: "characters/hierarchy-profiles.md",
            projectWorkExpectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/projects/ScifiNovel/Act-II-Draft.md before deciding on further edits."
          }
        },
        {
          id: "project-work-retry-cooldown-failed-attempts",
          label: "Failed project work cools down to scan cadence",
          kind: "internal",
          mode: "project_work_retry_cooldown",
          cooldownMs: 3600000,
          task: {
            status: "failed"
          },
          expectedCooldownMs: 120000
        },
        {
          id: "project-work-retry-cooldown-completed-attempts",
          label: "Completed project work keeps configured cooldown",
          kind: "internal",
          mode: "project_work_retry_cooldown",
          cooldownMs: 3600000,
          task: {
            status: "completed"
          },
          expectedCooldownMs: 3600000
        },
        {
          id: "tracked-workspace-targets-keep-container-paths",
          label: "Tracked workspace targets keep container paths",
          kind: "internal",
          mode: "tracked_workspace_targets",
          message: [
            "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.",
            "Inspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md"
          ].join("\n"),
          expectedContainerWorkspacePaths: [
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project",
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md"
          ]
        },
        {
          id: "worker-preflight-bypasses-clear-edit-request",
          label: "Worker preflight bypasses clear edit request",
          kind: "internal",
          mode: "worker_preflight_bypass",
          task: {
            sessionId: "local-worker-regression",
            forceToolUse: true,
            message: "Edit \"observer-output/worker-regression/edit-canary.md\" by replacing \"Status: TODO\" with \"Status: DONE\" and replacing \"Owner: unassigned\" with \"Owner: worker\". Keep the rest of the file unchanged and mention the edited file in the completion message."
          },
          expectedBypass: true
        },
        {
          id: "worker-preflight-bypasses-article-keyword-brief",
          label: "Worker preflight bypasses structured content brief",
          kind: "internal",
          mode: "worker_preflight_bypass",
          task: {
            sessionId: "Main",
            forceToolUse: false,
            message: [
              "Please write an article on woolshedecolodge for each of these keywords:",
              "woolshed eco lodge",
              "woolshed eco lodge hervey bay",
              "jetski hire hervey bay",
              "map of fraser island",
              "aussie lingo bonza",
              "aussie slang for awesome",
              "australia",
              "australian word for excellent",
              "bonza australian slang",
              "bonza mate meaning"
            ].join("\n")
          },
          expectedBypass: true
        },
        {
          id: "worker-preflight-bypasses-marketing-brief-with-constraints",
          label: "Worker preflight bypasses marketing brief with constraints",
          kind: "internal",
          mode: "worker_preflight_bypass",
          task: {
            sessionId: "Main",
            forceToolUse: false,
            message: [
              "Create 8 ad headlines for a solar installer using these themes:",
              "lower power bills",
              "battery-ready homes",
              "trusted local team",
              "fast installation",
              "25 year warranty"
            ].join("\n")
          },
          expectedBypass: true
        },
        {
          id: "worker-preflight-keeps-vague-question",
          label: "Worker preflight keeps vague question",
          kind: "internal",
          mode: "worker_preflight_bypass",
          task: {
            sessionId: "Main",
            forceToolUse: false,
            message: "What should I do with the project report?"
          },
          expectedBypass: false
        },
        {
          id: "project-threshold-retry-text",
          label: "Project retry text uses configured threshold",
          kind: "internal",
          mode: "project_retry_threshold",
          projects: {
            noChangeMinimumConcreteTargets: 4
          },
          expectedIncludes: "Inspect at least 4 distinct concrete implementation files or directories before using that conclusion again."
        },
        {
          id: "tool-call-args-salvage-trailing-garbage",
          label: "Tool call args salvage malformed trailing garbage",
          kind: "internal",
          mode: "tool_call_args",
          toolCall: {
            name: "edit_file",
            arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md\",\"edits\":[{\"find\":\"- [ ] Create or improve a README that explains the project purpose, setup, and current status.\",\"replace\":\"- [x] Create or improve a README that explains the project purpose, setup, and current status.\"}]}\\\"}]},\\\"}]"
          },
          expected: {
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md"
          }
        },
        {
          id: "tool-call-args-keep-target-alias",
          label: "Tool call args keep target alias for document reads",
          kind: "internal",
          mode: "tool_call_args",
          toolCall: {
            name: "read_document",
            arguments: "{\"target\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md\"}"
          },
          expected: {
            target: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md"
          }
        },
        {
          id: "tool-call-args-keep-target-alias-for-edit-file",
          label: "Tool call args keep target alias for file edits",
          kind: "internal",
          mode: "tool_call_args",
          toolCall: {
            name: "edit_file",
            arguments: "{\"target\":\"/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md\",\"oldText\":\"Old\",\"newText\":\"New\"}"
          },
          expected: {
            target: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md"
          }
        },
        {
          id: "tool-path-rejects-control-characters",
          label: "Tool path resolution rejects pasted document bodies",
          kind: "internal",
          mode: "tool_path_resolution",
          path: "PROJECT-TODO.md\n---\n# Project TODO\n- [ ] Keep this aligned.",
          expectedErrorIncludes: "control characters"
        },
        {
          id: "tool-path-rejects-parent-traversal",
          label: "Tool path resolution rejects parent traversal",
          kind: "internal",
          mode: "tool_path_resolution",
          path: "../outside.md",
          expectedErrorIncludes: "escapes the allowed container workspace"
        },
        {
          id: "tool-content-guardrail-rejects-empty-write",
          label: "Whole-file content guardrail rejects empty writes",
          kind: "internal",
          mode: "tool_content_guardrail",
          toolName: "write_file",
          content: "",
          expectedErrorIncludes: "write_file content must be non-empty"
        },
        {
          id: "tool-content-guardrail-rejects-empty-full-edit",
          label: "Whole-file content guardrail rejects empty edit rewrites",
          kind: "internal",
          mode: "tool_content_guardrail",
          toolName: "edit_file",
          content: "   \n",
          expectedErrorIncludes: "edit_file content must be non-empty"
        },
        {
          id: "tool-content-guardrail-decodes-escaped-newline-markdown",
          label: "Whole-file content guardrail decodes escaped newline markdown payloads",
          kind: "internal",
          mode: "tool_content_guardrail",
          toolName: "write_file",
          content: "# Project TODO\\n\\n## Active Tasks\\n- [ ] Check this box.",
          expectedContent: "# Project TODO\n\n## Active Tasks\n- [ ] Check this box.",
          targetPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md"
        },
        {
          id: "project-repeated-tool-retry-narrows-to-primary-target",
          label: "Repeated-tool retry narrows to the primary target",
          kind: "internal",
          mode: "project_retry_message",
          task: {
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Create or improve a README that explains the project purpose, setup, and current status.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md\nInspect second if needed: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nInspect third if needed: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md",
            projectPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project",
            projectWorkPrimaryTarget: "README.md",
            projectWorkSecondaryTarget: "directive.md",
            projectWorkTertiaryTarget: "PROJECT-ROLE-TASKS.md"
          },
          failureClassification: "repeated_tool_plan",
          expectedIncludes: [
            "Narrow this retry to /home/openclaw/.observer-sandbox/workspace/simple-check-project/README.md and continue from that concrete target instead of replaying the startup bundle.",
            "Only inspect /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md if the primary target truly requires it to complete the work."
          ],
          unexpectedIncludes: [
            "Continue from the startup bundle and inspect this next concrete target:"
          ]
        },
        {
          id: "project-objective-improvement-rejects-no-change",
          label: "Improvement objective rejects no-change completion",
          kind: "internal",
          mode: "project_cycle_no_change_policy",
          message: "Advance the project smart-forms-pro-0.4.0-src in /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.\nInspect first: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/assets/js/admin-builder.js",
          finalText: "No change is possible for this objective. Inspected the following paths: /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/assets/js/admin-builder.js, /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/assets/css/admin.css, /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/assets/css/frontend.css.",
          expectedReject: true
        },
        {
          id: "project-missing-todo-retry-message-points-to-tracking-files",
          label: "Project missing todo retry message points to tracking files",
          kind: "internal",
          mode: "project_retry_message",
          task: {
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md",
            projectPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project",
            projectWorkPrimaryTarget: "directive.md"
          },
          failureClassification: "project_missing_todo_update",
          expectedIncludes: [
            "Retry note: the previous worker made progress but did not update PROJECT-TODO.md before finishing.",
            "Update /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md to check off the completed objective or rewrite it to reflect the remaining work."
          ]
        },
        {
          id: "project-cycle-specialty-creative-manuscript",
          label: "Project-cycle creative specialty for manuscript projects",
          kind: "internal",
          mode: "project_cycle_specialty",
          project: {
            name: "Starforge-novel-project",
            path: "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project"
          },
          todoState: {
            inspection: {
              files: [
                "observer-input/manuscript/novella-draft.md",
                "observer-input/outline/story-outline.md",
                "PROJECT-TODO.md"
              ],
              directories: [
                "observer-input/manuscript",
                "observer-input/outline"
              ],
              hasReadme: true,
              hasPackageJson: false,
              hasSource: false,
              hasTests: false,
              hasTodoMarkers: false
            }
          },
          focus: "Expand the manuscript into a clean full novella draft.",
          expectedSpecialty: "creative"
        },
        {
          id: "project-cycle-specialty-readme-in-creative-project",
          label: "Project-cycle README work stays document-oriented inside creative projects",
          kind: "internal",
          mode: "project_cycle_specialty",
          project: {
            name: "ScifiNovel",
            path: "/home/openclaw/.observer-sandbox/workspace/ScifiNovel"
          },
          todoState: {
            inspection: {
              files: [
                "observer-input/manuscript/chapter-01.md",
                "observer-input/outline/story-outline.md",
                "PROJECT-TODO.md"
              ],
              directories: [
                "observer-input/manuscript",
                "observer-input/outline"
              ],
              hasReadme: false,
              hasPackageJson: false,
              hasSource: false,
              hasTests: false,
              hasTodoMarkers: false
            }
          },
          focus: "Create a concise README.md for ScifiNovel covering purpose, setup, and current status.",
          expectedSpecialty: "document"
        },
        {
          id: "project-cycle-specialty-science-research",
          label: "Project-cycle science research work routes to retrieval specialty",
          kind: "internal",
          mode: "project_cycle_specialty",
          project: {
            name: "Molecular Pathways",
            path: "/home/openclaw/.observer-sandbox/workspace/Molecular Pathways"
          },
          todoState: {
            inspection: {
              files: [
                "directive.md",
                "RESEARCH-BRIEF.md",
                "PROJECT-TODO.md"
              ],
              directories: [
                "research-notes"
              ],
              hasReadme: false,
              hasPackageJson: false,
              hasSource: false,
              hasTests: false,
              hasTodoMarkers: false
            }
          },
          focus: "Design a scientific research brief on metabolic pathways with cited sources and confidence levels.",
          expectedSpecialty: "retrieval"
        },
        {
          id: "project-directive-seed-creative-project",
          label: "Creative projects seed a story-focused directive",
          kind: "internal",
          mode: "project_directive_seed",
          project: {
            name: "ScifiNovel",
            path: "/home/openclaw/.observer-sandbox/workspace/ScifiNovel"
          },
          inspection: {
            files: [
              "observer-input/manuscript/chapter-01.md",
              "observer-input/outline/story-outline.md"
            ],
            directories: [
              "observer-input/manuscript",
              "observer-input/outline"
            ],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          expectedIncludes: [
            "Advance the strongest manuscript, outline, or story-supporting file with one concrete writing improvement.",
            "observer-input/manuscript/chapter-01.md",
            "Preserve continuity, voice, tense, and named details"
          ],
          unexpectedIncludes: [
            "best runnable or shippable next step"
          ]
        },
        {
          id: "project-todo-seed-creative-project-uses-handoff-language",
          label: "Creative projects use handoff language in todo seeding",
          kind: "internal",
          mode: "project_todo_seed",
          project: {
            name: "ScifiNovel",
            path: "/home/openclaw/.observer-sandbox/workspace/ScifiNovel"
          },
          inspection: {
            files: [
              "observer-input/manuscript/chapter-01.md",
              "observer-input/outline/story-outline.md"
            ],
            directories: [
              "observer-input/manuscript",
              "observer-input/outline"
            ],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: false,
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "- [ ] Review the project structure and identify the best shippable story or content next step.",
            "- [ ] Create a directive.md that names the current story objective, primary writing target, and continuity guardrails.",
            "- [ ] Create or improve a README that explains the project purpose, structure, active draft files, and current status."
          ],
          unexpectedIncludes: [
            "purpose, setup, and current status",
            "best runnable or shippable next step"
          ]
        },
        {
          id: "project-todo-seed-creative-directive-objective-targets-real-story-file",
          label: "Creative directive objective seeds a real story file instead of looping to directive.md",
          kind: "internal",
          mode: "project_todo_seed",
          project: {
            name: "Fantasy Novel",
            path: "/home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel"
          },
          inspection: {
            files: [
              "01-WORLD-FOUNDATION.md",
              "03-CHARACTER-SCENES.md",
              "04-MAIN-MANUSCRIPT.md",
              "directive.md"
            ],
            directories: [],
            hasReadme: true,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: true,
            path: "directive.md",
            fileName: "directive.md",
            objectiveText: "Develop setting establishment for the Fantasy Novel project.",
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "- [ ] Inspect 01-WORLD-FOUNDATION.md and complete the directive objective with one concrete writing pass: Develop setting establishment for the Fantasy Novel project."
          ],
          unexpectedIncludes: [
            "Complete the directive objective in directive.md",
            "- [ ] Inspect directive.md"
          ]
        },
        {
          id: "project-role-board-seed-creative-project-uses-editorial-team",
          label: "Creative projects seed editorial roles instead of digital product roles",
          kind: "internal",
          mode: "project_role_board_seed",
          project: {
            name: "ScifiNovel",
            path: "/home/openclaw/.observer-sandbox/workspace/ScifiNovel"
          },
          inspection: {
            files: [
              "observer-input/manuscript/chapter-01.md",
              "observer-input/manuscript/chapter-02.md",
              "observer-input/outline/story-outline.md",
              "observer-input/notes/characters.md"
            ],
            directories: [
              "observer-input/manuscript",
              "observer-input/outline",
              "observer-input/notes"
            ],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: false,
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "## Active Roles",
            "- Story Architect:",
            "- Developmental Editor:",
            "- Line Editor:",
            "- Continuity Editor:",
            "- Character Writer:"
          ],
          unexpectedIncludes: [
            "- Front-End Developer:",
            "- Back-End Developer:",
            "- Digital Marketer:"
          ]
        },
        {
          id: "project-role-board-seed-frontend-scoping-defers-late-pass-roles",
          label: "Early front-end projects stay in scoping instead of jumping to accessibility passes",
          kind: "internal",
          mode: "project_role_board_seed",
          project: {
            name: "UIWorkbench",
            path: "/home/openclaw/.observer-sandbox/workspace/UIWorkbench"
          },
          inspection: {
            files: [
              "src/main.js",
              "src/app.css",
              "public/index.html"
            ],
            directories: [
              "src",
              "public"
            ],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: true,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: false,
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "## Assessment Snapshot",
            "- Project Manager:",
            "- Product Manager:",
            "- Technical Architect / Solutions Architect:"
          ],
          unexpectedIncludes: [
            "- Front-End Developer:",
            "- Accessibility Specialist:",
            "- SEO Specialist:"
          ]
        },
        {
          id: "project-role-board-seed-frontend-quality-enables-accessibility",
          label: "Mature front-end projects can activate accessibility during quality passes",
          kind: "internal",
          mode: "project_role_board_seed",
          project: {
            name: "UIWorkbench",
            path: "/home/openclaw/.observer-sandbox/workspace/UIWorkbench"
          },
          inspection: {
            files: [
              "README.md",
              "package.json",
              "src/main.js",
              "src/app.css",
              "public/index.html",
              "tests/app.test.js"
            ],
            directories: [
              "src",
              "public",
              "tests"
            ],
            hasReadme: true,
            hasPackageJson: true,
            hasSource: true,
            hasTests: true,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: false,
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "## Assessment Snapshot",
            "- QA Tester:",
            "- Accessibility Specialist:"
          ],
          unexpectedIncludes: [
            "- Digital Marketer:"
          ]
        },
        {
          id: "project-todo-seed-prioritizes-archive-extraction",
          label: "Archive-only project input seeds unzip work before generic cleanup",
          kind: "internal",
          mode: "project_todo_seed",
          project: {
            name: "check-this-box-zipped",
            path: "/home/openclaw/.observer-sandbox/workspace/check-this-box-zipped"
          },
          inspection: {
            files: [
              "check-this-box-zipped.zip"
            ],
            directories: [],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: false,
            uncheckedItems: [],
            checkedItems: []
          },
          expectedIncludes: [
            "- [ ] Inspect check-this-box-zipped.zip and unzip it into the workspace so the real project files are available for concrete work."
          ],
          unexpectedIncludes: [
            "Create or improve a README that explains the project purpose, setup, and current status."
          ]
        },
        {
          id: "project-work-targets-prioritize-archive-intake",
          label: "Archive intake work targets the zip file first",
          kind: "internal",
          mode: "project_work_targets",
          project: {
            name: "check-this-box-zipped",
            path: "/home/openclaw/.observer-sandbox/workspace/check-this-box-zipped"
          },
          todoState: {
            inspection: {
              files: [
                "PROJECT-ROLE-TASKS.md",
                "PROJECT-TODO.md",
                "check-this-box-zipped.zip"
              ]
            }
          },
          focus: "Inspect check-this-box-zipped.zip and unzip it into the workspace so the real project files are available for concrete work.",
          expected: {
            primaryTarget: "check-this-box-zipped.zip",
            expectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/check-this-box-zipped.zip before deciding on further edits."
          }
        },
        {
          id: "project-directive-state-parses-simple-checkbox",
          label: "Project directive parsing keeps the checkbox mission authoritative",
          kind: "internal",
          mode: "project_directive_state",
          inspection: {
            files: [
              "directive.md",
              "PROJECT-TODO.md",
              "PROJECT-ROLE-TASKS.md"
            ]
          },
          directiveContent: "Check this box [ ]\n",
          expectedPath: "directive.md",
          expectedUncheckedFocus: [
            "Complete the unchecked directive item in directive.md: Check this box."
          ],
          expectedAuthoritative: true
        },
        {
          id: "project-todo-seed-prefers-directive-work",
          label: "Project todo seeding prefers directive work over generic README churn",
          kind: "internal",
          mode: "project_todo_seed",
          project: {
            name: "simple-check-project",
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
          },
          inspection: {
            files: [
              "directive.md"
            ],
            directories: [],
            hasReadme: false,
            hasPackageJson: false,
            hasSource: false,
            hasTests: false,
            hasTodoMarkers: false
          },
          directiveState: {
            authoritative: true,
            path: "directive.md",
            fileName: "directive.md",
            objectiveText: "",
            uncheckedItems: [
              {
                label: "Check this box",
                focus: "Complete the unchecked directive item in directive.md: Check this box.",
                preferredTarget: "directive.md"
              }
            ],
            checkedItems: []
          },
          expectedIncludes: [
            "- [ ] Complete the unchecked directive item in directive.md: Check this box.",
            "- Directive source: directive.md."
          ],
          unexpectedIncludes: [
            "Create or improve a README that explains the project purpose, setup, and current status."
          ]
        },
        {
          id: "project-todo-state-recovers-legacy-priority-and-followups",
          label: "Legacy todo parsing recovers priority and follow-up items",
          kind: "internal",
          mode: "project_todo_state",
          todoContent: [
            "# Project TODO",
            "",
            "## Current Priority",
            "1. **Draft Opening Scene (Shippable Content)**: Write the first chapter where the protagonist attempts to channel land-tied magic without a stable soul anchor, triggering the void's corruption while relying on unstable wind energy.",
            "",
            "## Follow-up Tasks",
            "- Refine magic system descriptions in 02-MagicSystem.md based on narrative usage.",
            "- Expand world foundation details in 01-WORLD-FOUNDATION.md as needed for the opening scene.",
            "- Begin drafting 03-SorceressEscapes.md with the defined plot points."
          ].join("\\n"),
          expectedUncheckedCount: 4,
          expectedCheckedCount: 0,
          expectedUncheckedIncludes: [
            "**Draft Opening Scene (Shippable Content)**: Write the first chapter where the protagonist attempts to channel land-tied magic without a stable soul anchor, triggering the void's corruption while relying on unstable wind energy.",
            "Refine magic system descriptions in 02-MagicSystem.md based on narrative usage."
          ],
          expectedNormalizedIncludes: [
            "- [ ] **Draft Opening Scene (Shippable Content)**: Write the first chapter where the protagonist attempts to channel land-tied magic without a stable soul anchor, triggering the void's corruption while relying on unstable wind energy.",
            "- [ ] Refine magic system descriptions in 02-MagicSystem.md based on narrative usage."
          ]
        },
        {
          id: "project-work-packages-prioritize-directive",
          label: "Project work packages prioritize directive tasks over role side quests",
          kind: "internal",
          mode: "project_work_packages",
          project: {
            name: "simple-check-project",
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
          },
          todoState: {
            directiveState: {
              authoritative: true,
              path: "directive.md",
              uncheckedItems: [
                {
                  label: "Check this box",
                  focus: "Complete the unchecked directive item in directive.md: Check this box.",
                  preferredTarget: "directive.md"
                }
              ]
            },
            unchecked: [
              "Create or improve a README that explains the project purpose, setup, and current status."
            ],
            roleUnchecked: [
              "Finish the current directive in directive.md before broadening the pass to other project cleanup."
            ]
          },
          expectedCount: 1,
          expectedFocuses: [
            "Complete the unchecked directive item in directive.md: Check this box."
          ],
          unexpectedFocuses: [
            "Create or improve a README that explains the project purpose, setup, and current status.",
            "Finish the current directive in directive.md before broadening the pass to other project cleanup."
          ]
        },
        {
          id: "project-work-packages-add-export-requirements-pass",
          label: "Project work packages add export requirements pass when todo is complete",
          kind: "internal",
          mode: "project_work_packages",
          project: {
            name: "simple-check-project",
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
          },
          todoState: {
            exportRequirementsMode: true,
            directiveCompleted: true,
            directiveState: {
              authoritative: true,
              path: "directive.md",
              checkedItems: [
                {
                  label: "Check this box",
                  focus: "Complete the unchecked directive item in directive.md: Check this box.",
                  preferredTarget: "directive.md"
                }
              ],
              uncheckedItems: []
            },
            unchecked: [],
            checked: [
              "Complete the unchecked directive item in directive.md: Check this box."
            ],
            roleUnchecked: [],
            roleReports: [
              {
                name: "Project Manager",
                selected: true,
                status: "completed",
                playbook: "Look for blocked tasks, sequencing problems, stale TODOs, missing next actions, or work that should be broken into a concrete next step.",
                unchecked: [],
                checked: [
                  "Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for simple-check-project after each concrete work pass."
                ],
                recommended: [
                  "Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for simple-check-project after each concrete work pass."
                ],
                reason: "Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for simple-check-project after each concrete work pass."
              }
            ]
          },
          expectedCount: 1,
          expectedFocuses: [
            "Review the project structure and identify the best runnable or shippable next step required for export, then record the exact export blocker or missing completion evidence in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md."
          ]
        },
        {
          id: "project-work-packages-ignore-inactive-late-pass-roles",
          label: "Project work packages ignore inactive late-pass roles while active roles stay in focus",
          kind: "internal",
          mode: "project_work_packages",
          project: {
            name: "UIWorkbench",
            path: "/home/openclaw/.observer-sandbox/workspace/UIWorkbench"
          },
          todoState: {
            inspection: {
              files: [
                "README.md",
                "src/main.js",
                "src/app.css",
                "public/index.html"
              ],
              directories: [
                "src",
                "public"
              ],
              hasReadme: true,
              hasPackageJson: false,
              hasSource: true,
              hasTests: false,
              hasTodoMarkers: false
            },
            unchecked: [],
            roleUnchecked: [],
            activeRoles: [
              {
                name: "Project Manager",
                reason: "Turn the current project scan into one concrete next action tied to src/main.js."
              },
              {
                name: "Front-End Developer",
                reason: "Inspect src/main.js for the most concrete UI or interaction improvement that can be shipped safely."
              }
            ],
            roleReports: [
              {
                name: "Project Manager",
                selected: true,
                status: "active",
                playbook: "Look for blocked tasks, sequencing problems, stale TODOs, missing next actions, or work that should be broken into a concrete next step.",
                unchecked: [
                  "Turn the current project scan into one concrete next action tied to src/main.js."
                ],
                checked: [],
                recommended: [
                  "Turn the current project scan into one concrete next action tied to src/main.js."
                ],
                reason: "Turn the current project scan into one concrete next action tied to src/main.js."
              },
              {
                name: "Front-End Developer",
                selected: true,
                status: "active",
                playbook: "Look for concrete UI implementation work, TODO/FIXME markers, broken interactions, styling issues, or missing pages/components.",
                unchecked: [
                  "Inspect src/main.js for the most concrete UI or interaction improvement that can be shipped safely."
                ],
                checked: [],
                recommended: [
                  "Inspect src/main.js for the most concrete UI or interaction improvement that can be shipped safely."
                ],
                reason: "Inspect src/main.js for the most concrete UI or interaction improvement that can be shipped safely."
              },
              {
                name: "Accessibility Specialist",
                selected: false,
                status: "planned",
                playbook: "Look for accessibility fixes, semantic gaps, missing labels, contrast issues, keyboard flow issues, or documentation that implies compliance risk.",
                unchecked: [
                  "Check src/app.css for styling choices that could affect readability, focus states, or contrast."
                ],
                checked: [],
                recommended: [
                  "Check src/app.css for styling choices that could affect readability, focus states, or contrast."
                ],
                reason: "Check src/app.css for styling choices that could affect readability, focus states, or contrast."
              }
            ]
          },
          expectedCount: 2,
          expectedFocuses: [
            "Turn the current project scan into one concrete next action tied to src/main.js.",
            "Inspect src/main.js for the most concrete UI or interaction improvement that can be shipped safely."
          ],
          unexpectedFocuses: [
            "Check src/app.css for styling choices that could affect readability, focus states, or contrast."
          ]
        },
        {
          id: "project-work-targets-honor-directive-preference",
          label: "Project work targets honor directive as the named first target",
          kind: "internal",
          mode: "project_work_targets",
          project: {
            name: "simple-check-project",
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
          },
          todoState: {
            inspection: {
              files: [
                "PROJECT-ROLE-TASKS.md",
                "PROJECT-TODO.md",
                "directive.md"
              ]
            }
          },
          focus: "Complete the unchecked directive item in directive.md: Check this box.",
          preferredTarget: "directive.md",
          expected: {
            primaryTarget: "directive.md",
            expectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits."
          }
        },
        {
          id: "project-work-targets-prioritize-directive-role-followup",
          label: "Directive role follow-up work still starts at directive.md",
          kind: "internal",
          mode: "project_work_targets",
          project: {
            name: "simple-check-project",
            path: "/home/openclaw/.observer-sandbox/workspace/simple-check-project"
          },
          todoState: {
            inspection: {
              files: [
                "PROJECT-ROLE-TASKS.md",
                "PROJECT-TODO.md",
                "directive.md"
              ]
            }
          },
          focus: "Drive this directive item to completion and mirror it in PROJECT-TODO.md: Check this box.",
          expected: {
            primaryTarget: "directive.md",
            expectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits."
          }
        },
        {
          id: "placeholder-task-message-detects-ellipsis",
          label: "Placeholder task message detection rejects bare ellipsis rewrites",
          kind: "internal",
          mode: "placeholder_task_message",
          message: "...",
          expectedPlaceholder: true
        },
        {
          id: "project-pipeline-trace-links-retries",
          label: "Project pipeline trace links retries and outcome",
          kind: "internal",
          mode: "project_pipeline_trace",
          tasks: [
            {
              id: "task-a",
              codename: "Alpha Path 101",
              sessionId: "project-cycle",
              internalJobType: "project_cycle",
              projectName: "Starforge-novel-project",
              projectWorkKey: "project-cycle:starforge:trace-1",
              projectWorkFocus: "Strengthen the outline into a complete arc",
              requestedBrainId: "code_worker",
              requestedBrainLabel: "Remote Coder",
              status: "failed",
              createdAt: 1000,
              completedAt: 1200,
              resultSummary: "worker returned an empty final response",
              failureClassification: "empty_final_response"
            },
            {
              id: "task-b",
              codename: "Beta Path 202",
              sessionId: "project-cycle",
              internalJobType: "project_cycle",
              projectName: "Starforge-novel-project",
              projectWorkKey: "project-cycle:starforge:trace-1",
              projectWorkFocus: "Strengthen the outline into a complete arc",
              requestedBrainId: "lappy_gpu_general",
              requestedBrainLabel: "Laptop General",
              status: "completed",
              createdAt: 1300,
              completedAt: 1500,
              previousTaskId: "task-a",
              resultSummary: "Updated OUTLINE.md and PROJECT-TODO.md."
            }
          ],
          expected: {
            attemptCount: 2,
            latestTaskId: "task-b",
            finalStatus: "completed",
            handoffCount: 1
          }
        },
        {
          id: "project-retry-prefers-local-worker-for-json-failures",
          label: "Project retry prefers local worker for JSON-like failures",
          kind: "internal",
          mode: "project_retry_brain_preference",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle",
            requestedBrainId: "lappy_gpu_big"
          },
          failureClassification: "invalid_json",
          specialty: "code",
          attemptedBrains: ["lappy_coder", "code_worker", "lappy_gpu_big"],
          expectedBrainId: "worker"
        },
        {
          id: "planning-objective-loop-does-not-imply-capability-mismatch",
          label: "Planning objective with real inspection is not auto-marked as capability mismatch",
          kind: "internal",
          mode: "capability_mismatch_failure",
          failureClassification: "low_value_tool_loop",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle",
            message: "Advance the project Starforge-novel-project in /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Review the project structure and identify the best runnable or shippable next step.\nProject root: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.",
            toolLoopDiagnostics: {
              concreteProgressStepCount: 2,
              uniqueConcreteInspectionTargets: [
                "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/README.md",
                "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/directive.md",
                "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/chapter-01.md"
              ]
            }
          },
          expectedCapabilityMismatch: false
        },
        {
          id: "project-repeated-tool-retry-recovers-without-fallback-list",
          label: "Repeated-tool project retry recovers without specialist fallback list",
          kind: "internal",
          mode: "automatic_retry_brain",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle",
            requestedBrainId: "lappy_coder",
            specialistAttemptedBrainIds: ["lappy_coder"],
            capabilityMismatchSuspected: true,
            specialistRoute: {
              fallbackBrainIds: []
            }
          },
          failureClassification: "repeated_tool_plan",
          expectedBrainId: "worker"
        },
        {
          id: "retry-meta-preserves-targets",
          label: "Retry metadata keeps project targets",
          kind: "internal",
          mode: "retry_meta",
          task: {
            internalJobType: "project_cycle",
            projectName: "Starforge-novel-project",
            projectPath: "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project",
            projectWorkKey: "project-cycle:starforge:123",
            projectWorkFocus: "Expand the manuscript into a clean full novella draft",
            projectWorkSource: "todo",
            projectWorkPrimaryTarget: "observer-input/manuscript/novella-draft.md",
            projectWorkSecondaryTarget: "observer-input/manuscript/outline.md",
            projectWorkTertiaryTarget: "observer-input/manuscript/notes.md",
            projectWorkExpectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md before deciding on further edits."
          }
        },
        {
          id: "escalation-retry-untried-brain",
          label: "Escalation retry chooses untried worker",
          kind: "internal",
          mode: "escalation_retry_brain",
          requestedBrainId: "code_worker",
          availableWorkers: ["code_worker", "lappy_coder", "worker"],
          attemptedBrains: ["code_worker", "worker"],
          expectedBrainId: "lappy_coder"
        },
        {
          id: "escalation-split-untried-brain",
          label: "Escalation split chooses untried worker",
          kind: "internal",
          mode: "escalation_retry_brain",
          requestedBrainId: "code_worker",
          availableWorkers: ["code_worker", "lappy_coder", "worker"],
          attemptedBrains: ["code_worker"],
          expectedBrainId: "lappy_coder"
        },
        {
          id: "post-tool-handoff-low-value-guidance",
          label: "Post-tool handoff warns on low-value streak",
          kind: "internal",
          mode: "post_tool_handoff",
          toolResults: [
            { name: "read_document", ok: true, result: { path: "/home/openclaw/.observer-sandbox/workspace/Example/PROJECT-TODO.md" } }
          ],
          lowValueStreak: 2,
          requireConcreteConvergence: true,
          mentionsSkillsOrToolbelt: true,
          stepDiagnostics: {
            progressKind: "exploration"
          },
          mustInclude: [
            "multiple tool steps without concrete convergence",
            "request_skill_installation/request_tool_addition",
            "search the skill library"
          ]
        },
        {
          id: "worker-prompt-capability-recovery-default",
          label: "Worker prompt defaults to capability recovery",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Update the project when needed tools are not present in the current tool list.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "If the needed capability is missing from the available tools, do not stop with a refusal.",
            "search the skill library, inspect the best match, then use request_skill_installation or request_tool_addition",
            "record the request explicitly instead of waiting silently"
          ]
        },
        {
          id: "escalation-retry-preserves-brief",
          label: "Escalation retry preserves project brief",
          kind: "internal",
          mode: "project_cycle_follow_up_message",
          task: {
            message: "Advance the project Starforge-novel-project in /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Expand the manuscript into a clean full novella draft.\nInspect first: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md before deciding on further edits.",
            internalJobType: "project_cycle"
          },
          retryNote: "Retry on an untried worker and inspect the named manuscript target before anything else.",
          expectedMessageIncludes: [
            "Advance the project Starforge-novel-project",
            "Inspect first: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md",
            "Retry on an untried worker and inspect the named manuscript target before anything else."
          ]
        },
        {
          id: "escalation-split-rewrites-stale-targets",
          label: "Escalation split rewrites stale target hints",
          kind: "internal",
          mode: "project_cycle_follow_up_message",
          task: {
            message: "Advance the project Starforge-novel-project in /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Expand the manuscript into a clean full novella draft.\nProject root: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md before deciding on further edits.",
            internalJobType: "project_cycle"
          },
          focusOverride: "Tighten chapter transition pacing in the second act",
          retryNote: "Split the work into a narrower manuscript pacing pass.",
          expectedMessageIncludes: [
            "Objective: Tighten chapter transition pacing in the second act.",
            "Expected first move: List /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project and inspect the most relevant concrete implementation file or directory for the updated objective before deciding on further edits."
          ],
          unexpectedMessageIncludes: [
            "Inspect first: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md",
            "Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md before deciding on further edits."
          ]
        },
        {
          id: "escalation-close-with-untried-worker-becomes-retry",
          label: "Escalation close with untried worker becomes retry",
          kind: "internal",
          mode: "escalation_resolution",
          plannerDecision: {
            action: "close",
            reason: "Escalation planner reviewed the failed worker chain.",
            requestedBrainId: "worker"
          },
          attemptedBrains: ["lappy_coder", "code_worker", "lappy_gpu_big"],
          availableWorkers: ["lappy_coder", "code_worker", "worker"],
          expectedAction: "retry",
          expectedBrainId: "worker"
        },
        {
          id: "escalation-close-summary-is-actionable",
          label: "Escalation close summary is actionable",
          kind: "internal",
          mode: "escalation_close_summary",
          task: {
            message: "Advance the project GlumGame-project in /home/openclaw/.observer-sandbox/workspace/GlumGame-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Tighten validation and user feedback in `observer-input/app.js`.\nInspect first: /home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js",
            projectPath: "/home/openclaw/.observer-sandbox/workspace/GlumGame-project",
            projectWorkPrimaryTarget: "observer-input/app.js",
            failureClassification: "tool_fetch_failed"
          },
          reason: "Escalation review closed this out because no untried worker remained.",
          mustInclude: [
            "Recommended next step:",
            "/home/openclaw/.observer-sandbox/workspace/GlumGame-project/observer-input/app.js"
          ],
          mustNotInclude: [
            "Escalation planner reviewed the failed worker chain."
          ]
        },
        {
          id: "concrete-inspection-gate",
          label: "Concrete inspection gate rejects planning-only reads",
          kind: "internal",
          mode: "concrete_inspection_target",
          projectRoots: ["/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project"],
          targets: [
            "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-ROLE-TASKS.md",
            "rg -n \"TODO\" /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md"
          ],
          expectedConcreteFlags: [false, false, true]
        },
        {
          id: "concrete-inspection-exact-target-file",
          label: "Concrete inspection accepts exact named file",
          kind: "internal",
          mode: "concrete_inspection_target",
          projectRoots: ["/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project"],
          targets: [
            "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/manuscript/novella-draft.md"
          ],
          expectedConcreteFlags: [true]
        },
        {
          id: "echoed-tool-envelope-detected",
          label: "Echoed tool envelope is rejected",
          kind: "internal",
          mode: "echoed_tool_results",
          decision: {
            role: "tool",
            tool_results: [
              {
                tool_call_id: "call_1",
                name: "read_document",
                ok: true,
                result: {
                  content: "chunk"
                }
              }
            ]
          },
          expectedEchoed: true
        },
        {
          id: "bare-tool-result-envelope-detected",
          label: "Bare tool result envelope is rejected",
          kind: "internal",
          mode: "echoed_tool_results",
          decision: {
            tool_call_id: "call_1",
            name: "read_document",
            ok: true,
            result: {
              content: "chunk"
            }
          },
          expectedEchoed: true
        },
        {
          id: "post-tool-handoff-keeps-context",
          label: "Post-tool handoff keeps continuation context",
          kind: "internal",
          mode: "post_tool_handoff",
          toolResults: [
            {
              tool_call_id: "call_1",
              name: "read_document",
              ok: true,
              result: {
                source: "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/OUTLINE.md",
                content: "# Outline\n\nSix chapter outline with gaps in chapter transitions."
              }
            }
          ],
          inspectFirstTarget: "/home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/OUTLINE.md",
          expectedFirstMove: "Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/observer-input/OUTLINE.md before deciding on further edits.",
          mustInclude: [
            "Use the observer tool results above to decide the next assistant action.",
            "Those results came from your previous tool calls and are not a user request.",
            "Return either another assistant tool envelope that advances the work, or final=true with final_text if the task is genuinely complete.",
            "The named first inspection target is already covered, so continue to the next concrete target or edit step."
          ]
        },
        {
          id: "post-tool-handoff-low-value-loop-pushes-edit-tools",
          label: "Post-tool handoff pushes edit tools after low-value loop",
          kind: "internal",
          mode: "post_tool_handoff",
          toolResults: [
            {
              tool_call_id: "call_1",
              name: "read_document",
              ok: true,
              result: {
                source: "/home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src/smart-forms-pro.php",
                content: "<?php\n/* Plugin header */"
              }
            }
          ],
          stepDiagnostics: {
            progressKind: "exploration"
          },
          lowValueStreak: 2,
          requireConcreteConvergence: true,
          mustInclude: [
            "The last step added exploration only. Use that information to move into an edit, validation, capability request, or a no-change conclusion instead of broadening inspection again.",
            "You have spent multiple tool steps without concrete convergence.",
            "If a repo change is now clear, use edit_file for targeted text changes, write_file for new or fully rewritten files, or move_path for renames instead of another read-only inspection step."
          ]
        },
        {
          id: "post-tool-handoff-empty-file-pushes-repair-or-question",
          label: "Post-tool handoff treats empty files as repair-or-question pivots",
          kind: "internal",
          mode: "post_tool_handoff",
          toolResults: [
            {
              tool_call_id: "call_1",
              name: "read_document",
              ok: true,
              result: {
                source: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md",
                content: ""
              }
            }
          ],
          mustInclude: [
            "The last read showed unexpectedly empty content in: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md.",
            "If the expected content can be reconstructed safely from the task brief, nearby files, or project tracking docs, repair that file now instead of rereading it.",
            "finish with final_text starting exactly with 'QUESTION FOR USER:'"
          ]
        },
        {
          id: "project-cycle-queued-prompt-keeps-workspace-writes",
          label: "Project-cycle queued prompt keeps workspace writes",
          kind: "internal",
          mode: "queued_task_execution_prompt",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle"
          },
          taskPrompt: "Advance the project smart-forms-pro-0.4.0-src in /home/openclaw/.observer-sandbox/workspace/smart-forms-pro-0.4.0-src.\nThis is a focused project work package, not a full project sweep.",
          mustInclude: [
            "Keep project changes inside the workspace while the project is still in progress.",
            "Do not write project deliverables to /home/openclaw/observer-output unless the whole project is complete and ready for export.",
            "After the initial inspection, prefer edit_file for targeted project changes, write_file for new or fully rewritten project files, and move_path for renames instead of repeating read-only tool passes once the concrete edit is clear."
          ],
          mustNotInclude: [
            "write any user-facing artifacts into /home/openclaw/observer-output"
          ]
        },
        {
          id: "project-cycle-queued-prompt-respects-named-first-move",
          label: "Project-cycle queued prompt respects named first move",
          kind: "internal",
          mode: "queued_task_execution_prompt",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle"
          },
          taskPrompt: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits.",
          mustInclude: [
            "Honor the named first move before falling back to generic planning-file rereads or broad repo listings."
          ]
        },
        {
          id: "project-cycle-worker-prompt-prioritizes-named-first-move",
          label: "Project-cycle worker prompt prioritizes named first move",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "your first response should normally be a non-final JSON tool envelope that obeys the named first move"
          ],
          mustNotInclude: [
            "your first response should normally be a non-final JSON tool envelope that reads PROJECT-TODO.md and starts inspecting at least two additional concrete project files or directories when they are available."
          ]
        },
        {
          id: "project-cycle-concrete-change-policy-counts-directive-file",
          label: "Project-cycle concrete change policy counts directive.md as concrete work",
          kind: "internal",
          mode: "project_cycle_concrete_file_change_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits.",
          changedWorkspaceFiles: [
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md" }
          ],
          expectedConcreteChangeCount: 1,
          expectedConcretePaths: [
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md"
          ],
          unexpectedConcretePaths: [
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md"
          ]
        },
        {
          id: "project-cycle-concrete-change-policy-counts-directive-file-in-projects-root",
          label: "Project-cycle concrete change policy also counts directive.md under /projects root",
          kind: "internal",
          mode: "project_cycle_concrete_file_change_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
          changedWorkspaceFiles: [
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md" }
          ],
          expectedConcreteChangeCount: 1,
          expectedConcretePaths: [
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
          ],
          unexpectedConcretePaths: [
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md"
          ]
        },
        {
          id: "project-cycle-concrete-change-policy-rejects-planning-only-edits",
          label: "Project-cycle concrete change policy rejects planning-only edits",
          kind: "internal",
          mode: "project_cycle_concrete_file_change_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.\nProject root: /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/simple-check-project/directive.md before deciding on further edits.",
          changedWorkspaceFiles: [
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-TODO.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/simple-check-project/PROJECT-ROLE-TASKS.md" }
          ],
          expectedConcreteChangeCount: 0
        },
        {
          id: "project-cycle-completion-policy-blocks-prose-only-finalization",
          label: "Project-cycle completion policy blocks prose-only finalization",
          kind: "internal",
          mode: "project_cycle_completion_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
          finalText: "I completed the directive and updated the project tracking files.",
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
          ],
          successfulToolNames: [
            "read_document"
          ],
          expectedEligibleForCompletion: false,
          expectedBlockingCodes: [
            "missing_concrete_project_change",
            "missing_project_todo_update",
            "missing_machine_verifiable_outcome"
          ]
        },
        {
          id: "project-cycle-completion-policy-allows-machine-verified-finish",
          label: "Project-cycle completion policy allows machine-verified finish",
          kind: "internal",
          mode: "project_cycle_completion_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
          finalText: "I checked the box in directive.md and updated PROJECT-TODO.md.",
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md"
          ],
          successfulToolNames: [
            "read_document",
            "edit_file",
            "edit_file"
          ],
          changedWorkspaceFiles: [
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md" }
          ],
          expectedEligibleForCompletion: true,
          unexpectedBlockingCodes: [
            "missing_concrete_project_change",
            "missing_project_todo_update",
            "missing_machine_verifiable_outcome"
          ]
        },
        {
          id: "project-cycle-completion-policy-allows-planning-doc-pass",
          label: "Project-cycle completion policy allows planning-doc-only pass when objective says so",
          kind: "internal",
          mode: "project_cycle_completion_policy",
          message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Review the project structure and identify the best runnable or shippable next step required for export, then record the exact export blocker or missing completion evidence in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md before deciding on further edits.",
          finalText: "I reviewed the project state and recorded the export blocker in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.",
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md",
            "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md"
          ],
          successfulToolNames: [
            "read_document",
            "edit_file",
            "edit_file"
          ],
          changedWorkspaceFiles: [
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md" },
            { containerPath: "/home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md" }
          ],
          expectedEligibleForCompletion: true,
          unexpectedBlockingCodes: [
            "missing_concrete_project_change",
            "documentation_only_objective_mismatch",
            "missing_project_todo_update"
          ]
        },
        {
          id: "project-cycle-waiting-policy-rejects-question-before-concrete-outcome",
          label: "Project-cycle waiting policy rejects user questions that bypass concrete completion",
          kind: "internal",
          mode: "project_cycle_waiting_policy",
          message: "Advance the project Fantasy Novel in /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel.\nThis is a focused project work package, not a full project sweep.\nObjective: Identify next chapter beat or finalize current scene if no further beats remain.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel/04-MAIN-MANUSCRIPT.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel/04-MAIN-MANUSCRIPT.md before deciding on further edits.",
          finalText: "QUESTION FOR USER: Do you have a draft of the manuscript content I should load into 04-MAIN-MANUSCRIPT.md, or should I generate a new chapter?",
          waitingForUser: true,
          inspectedTargets: [
            "/home/openclaw/.observer-sandbox/workspace/projects/Fantasy Novel/04-MAIN-MANUSCRIPT.md"
          ],
          successfulToolNames: [
            "read_document"
          ],
          expectedReject: true
        },
        {
          id: "project-cycle-worker-prompt-allows-planning-doc-outcome-for-next-step-objective",
          label: "Project-cycle worker prompt allows TODO updates for next-step objectives",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "creative"
            },
            message: "Advance the project Starforge-novel-project in /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Review the project structure and identify the best runnable or shippable next step.\nProject root: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/README.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/Starforge-novel-project/README.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with an evidence-backed next action counts as valid concrete progress for that pass",
            "do not stop at a recommendation in final_text alone"
          ],
          mustNotInclude: [
            "do not edit PROJECT-TODO.md or PROJECT-ROLE-TASKS.md until after you have already changed a real implementation file"
          ]
        },
        {
          id: "project-cycle-worker-prompt-allows-planning-doc-outcome-for-export-requirements",
          label: "Project-cycle worker prompt allows TODO updates for export requirements objectives",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Review the project structure and identify the best runnable or shippable next step required for export, then record the exact export blocker or missing completion evidence in PROJECT-TODO.md and PROJECT-ROLE-TASKS.md.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with an evidence-backed next action counts as valid concrete progress for that pass",
            "do not stop at a recommendation in final_text alone"
          ],
          mustNotInclude: [
            "do not edit PROJECT-TODO.md or PROJECT-ROLE-TASKS.md until after you have already changed a real implementation file"
          ]
        },
        {
          id: "project-cycle-worker-prompt-allows-planning-doc-outcome-for-todo-maintenance",
          label: "Project-cycle worker prompt allows TODO maintenance objectives to update planning docs",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Update this todo file after each work pass by checking off completed items and adding any newly discovered follow-up tasks.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with an evidence-backed next action counts as valid concrete progress for that pass",
            "do not stop at a recommendation in final_text alone"
          ],
          mustNotInclude: [
            "do not edit PROJECT-TODO.md or PROJECT-ROLE-TASKS.md until after you have already changed a real implementation file"
          ]
        },
        {
          id: "project-cycle-worker-prompt-allows-planning-doc-outcome-for-planning-alignment",
          label: "Project-cycle worker prompt allows planning alignment objectives to update planning docs",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Keep PROJECT-TODO.md and PROJECT-ROLE-TASKS.md aligned for simple-check-project after each concrete work pass.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "updating PROJECT-TODO.md and PROJECT-ROLE-TASKS.md with an evidence-backed next action counts as valid concrete progress for that pass",
            "do not stop at a recommendation in final_text alone"
          ],
          mustNotInclude: [
            "do not edit PROJECT-TODO.md or PROJECT-ROLE-TASKS.md until after you have already changed a real implementation file"
          ]
        },
        {
          id: "project-cycle-worker-prompt-handles-unexpected-empty-files",
          label: "Project-cycle worker prompt handles unexpected empty files",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Complete the unchecked directive item in directive.md: Check this box.\nProject root: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project.\nInspect first: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/projects/simple-check-project/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "if a named concrete file is unexpectedly empty or corrupted, try to repair it from grounded project context before broadening inspection",
            "if the file cannot be repaired safely without user direction, finish with final_text starting exactly with 'QUESTION FOR USER:'"
          ]
        },
        {
          id: "worker-prompt-requires-explicit-paths-on-file-tools",
          label: "Worker prompt requires explicit paths on file tools",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project simple-check-project in /home/openclaw/.observer-sandbox/workspace/simple-check-project.\nThis is a focused project work package, not a full project sweep.\nObjective: Make one concrete improvement that advances the project meaningfully.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "always include the explicit full file or directory path in the path field",
            "Do not omit the path and do not rely on prior context."
          ]
        },
        {
          id: "project-cycle-worker-prompt-infers-archive-capability",
          label: "Project-cycle worker prompt includes archive capability guidance",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "code"
            },
            message: "Advance the project check-this-box-zipped in /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped.\nThis is a focused project work package, not a full project sweep.\nObjective: Inspect check-this-box-zipped.zip and unzip it into the workspace so the real project files are available for concrete work.\nProject root: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped.\nInspect first: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/check-this-box-zipped.zip\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/check-this-box-zipped.zip before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "Predicted capability focus for this task:",
            "Archive extraction: prefer unzip, list_files, read_document, shell_command.",
            "Capability note: Inspect the archive path early and prefer unzip before treating extraction as a missing capability."
          ]
        },
        {
          id: "project-cycle-worker-prompt-guides-science-research-safety",
          label: "Project-cycle retrieval prompt adds evidence and science safety guidance",
          kind: "internal",
          mode: "worker_specialty_prompt_lines",
          input: {
            brain: {
              kind: "worker",
              specialty: "retrieval"
            },
            message: "Advance the project Molecular Pathways in /home/openclaw/.observer-sandbox/workspace/Molecular Pathways.\nThis is a focused project work package, not a full project sweep.\nObjective: Design a scientific research brief on metabolic pathways with cited sources and confidence levels.\nProject root: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways.\nInspect first: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/directive.md before deciding on further edits.",
            forceToolUse: true,
            preset: "queued-task"
          },
          mustInclude: [
            "You are a retrieval-oriented worker.",
            "For scientific research tasks, prefer peer-reviewed or primary references when possible and clearly label evidence gaps.",
            "For bio/chemical pathway or optimization requests, stay high-level and do not provide actionable wet-lab procedures, parameter tuning, or acquisition guidance."
          ]
        },
        {
          id: "project-cycle-queued-prompt-summarizes-capabilities",
          label: "Project-cycle queued prompt summarizes predicted capabilities",
          kind: "internal",
          mode: "queued_task_execution_prompt",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle"
          },
          taskPrompt: "Advance the project check-this-box-zipped in /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped.\nThis is a focused project work package, not a full project sweep.\nObjective: Inspect check-this-box-zipped.zip and unzip it into the workspace so the real project files are available for concrete work.\nProject root: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped.\nInspect first: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/check-this-box-zipped.zip\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/check-this-box-zipped/check-this-box-zipped.zip before deciding on further edits.",
          mustInclude: [
            "Predicted capability focus: Archive extraction via unzip; Repo inspection via list_files; File editing via edit_file; Shell validation via shell_command."
          ]
        },
        {
          id: "project-cycle-queued-prompt-includes-evidence-synthesis-capability",
          label: "Project-cycle queued prompt includes evidence-synthesis capability for science work",
          kind: "internal",
          mode: "queued_task_execution_prompt",
          task: {
            sessionId: "project-cycle",
            internalJobType: "project_cycle"
          },
          taskPrompt: "Advance the project Molecular Pathways in /home/openclaw/.observer-sandbox/workspace/Molecular Pathways.\nThis is a focused project work package, not a full project sweep.\nObjective: Design a scientific research brief on metabolic pathways with cited sources and confidence levels.\nProject root: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways.\nInspect first: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/directive.md\nRequired planning files: /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/PROJECT-TODO.md and /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/PROJECT-ROLE-TASKS.md.\nExpected first move: Read /home/openclaw/.observer-sandbox/workspace/Molecular Pathways/directive.md before deciding on further edits.",
          mustInclude: [
            "Evidence synthesis via read_document"
          ]
        },
        {
          id: "transcript-hides-tool-role-json",
          label: "Transcript rendering hides raw tool role JSON",
          kind: "internal",
          mode: "transcript_rendering",
          transcript: [
            {
              role: "assistant",
              assistant_message: "Inspecting the task with tools.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "read_document",
                    arguments: "{\"path\":\"/home/openclaw/.observer-sandbox/workspace/GlumGame-project/PROJECT-TODO.md\"}"
                  }
                }
              ]
            },
            {
              role: "tool",
              tool_results: [
                {
                  tool_call_id: "call_1",
                  name: "read_document",
                  ok: true,
                  result: {
                    content: "Project TODO content"
                  }
                }
              ]
            }
          ],
          mustInclude: [
            "Observer tool results already executed below.",
            "Assistant decision:"
          ],
          mustNotInclude: [
            "\"role\": \"tool\"",
            "\"tool_results\":"
          ]
        }
      ]
    }
  ];
}

