# Quick Reference: Semantic Compression Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OBSERVER TOOL EXECUTION FLOW                         │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌──────────────────┐
                            │   LLM Model      │
                            │   (Less Noise!)  │
                            └────────┬─────────┘
                                     ▲
                                     │
                    ┌────────────────────────────────┐
                    │  SEMANTIC COMPRESSION LAYER    │
                    │  ─────────────────────────────  │
                    │  • Auto-detect output type     │
                    │  • Extract key information     │
                    │  • Remove noise                │
                    │  • Validate density (>70%)     │
                    │  • Calculate signature         │
                    │  • Format for model            │
                    └────────────┬───────────────────┘
                                 ▲
              ┌──────────────────┼──────────────────┐
              │                  │                  │
         ┌────┴────┐         ┌───┴────┐        ┌───┴────┐
         │   AST   │         │ Shell  │        │  Tool  │
         │ Parser  │         │ Output │        │ Result │
         │─────────│         │Compress│        │Compress│
         │ extract │         │────────│        │────────│
         │tokens,  │         │• Error │        │• JSON/ │
         │semantics│         │ detect │        │  Code/ │
         │, errors │         │• Key   │        │  Diff  │
         └────┬────┘         │ lines  │        │ typing │
              │              │• Time  │        │        │
              │              └───┬────┘        └───┬────┘
              │                  │                 │
              └──────────────┬───┴─────────────────┴──┐
                             │                        │
                    ┌────────┴────────┐               │
                    │  SANDBOX I/O    │               │
                    │  SHELL RESULTS  │◄──────────────┘
                    └─────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                      COMPRESSED OUTPUT EXAMPLE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BEFORE (Raw Output - 12KB):                                               │
│  ──────────────────────────                                                │
│  npm WARN deprecated uuid@3.4.0: Please upgrade...                        │
│  npm notice                                                                 │
│  npm notice New major version of npm available...                          │
│  ... [100+ lines of noise] ...                                             │
│  added 42 packages, and audited 215 packages in 3s                         │
│  found 2 vulnerabilities (1 moderate, 1 high)                              │
│  Information Density: ~25%                                                  │
│                                                                             │
│  ↓ COMPRESSION ↓                                                            │
│                                                                             │
│  AFTER (Semantic Map - 380 bytes):                                         │
│  ─────────────────────────────────                                         │
│  {                                                                          │
│    "tool": "npm-install",                                                  │
│    "type": "log",                                                           │
│    "informationDensity": 82,                                                │
│    "keyFindings": [                                                         │
│      "added 42 packages",                                                   │
│      "found 2 vulnerabilities (1 moderate, 1 high)"                        │
│    ],                                                                       │
│    "semantic": {                                                            │
│      "levels": { "warn": 2, "notice": 3 },                                 │
│      "modules": ["npm"]                                                     │
│    },                                                                       │
│    "modelFormat": "[npm:log] added:42 vulnerabilities:2 density:82%"      │
│  }                                                                          │
│  Information Density: ~82%                                                  │
│  Compression Ratio: 32:1                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                       INTEGRATION POINTS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SANDBOX I/O SERVICE                                                     │
│     File: server/sandbox-io-service.js                                      │
│     Replace: result.stdout → await compressShellResult(result)              │
│     ┌──────────────────────────────────────────────────────────┐            │
│     │ const result = await runGatewayShell(command);           │            │
│     │ const compressed = await compressShellResult(result);    │            │
│     │ return compressed.modelFormat;  // Pass to model         │            │
│     └──────────────────────────────────────────────────────────┘            │
│                                                                             │
│  2. TOOL EXECUTION RUNNER                                                   │
│     File: server/observer-execution-runner.js                               │
│     Replace: Verbose transcripts → Semantic maps                            │
│     ┌──────────────────────────────────────────────────────────┐            │
│     │ const adapter = createToolLoopCompressionAdapter();      │            │
│     │ const compressed = adapter.compressToolCallResult(...);  │            │
│     │ task.compressedToolContext = compressed;                │            │
│     └──────────────────────────────────────────────────────────┘            │
│                                                                             │
│  3. TASK PROMPTING                                                          │
│     File: server/observer-queued-task-prompting.js                          │
│     Inject: Semantic maps before task description                           │
│     ┌──────────────────────────────────────────────────────────┐            │
│     │ const prompt = buildTaskPrompt(task);                    │            │
│     │ // Compressed context automatically injected             │            │
│     │ return enhanceWithSemanticContext(prompt);               │            │
│     └──────────────────────────────────────────────────────────┘            │
│                                                                             │
│  4. WORKER PROMPTING                                                        │
│     File: server/observer-worker-prompting.js                               │
│     Track: Compression metrics for monitoring                               │
│     ┌──────────────────────────────────────────────────────────┐            │
│     │ const metrics = new CompressionMetrics();                │            │
│     │ metrics.recordCompression(original, compressed);         │            │
│     │ console.log(metrics.getStats());                         │            │
│     └──────────────────────────────────────────────────────────┘            │
│                                                                             │
│  5. CORE STATE (Optional)                                                   │
│     File: server/observer-core-state.js                                     │
│     Add: Compression config to observer.config.json                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                         KEY METRICS                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✓ Information Density       Target: >70%  (Currently: ~25%)               │
│  ✓ Compression Ratio         Target: 10:1  (Currently: 1:1 = none)         │
│  ✓ Processing Time           Target: <5ms  (Baseline: N/A)                 │
│  ✓ Error Preservation        Target: 100%  (Verify with TDD)               │
│  ✓ Model Quality             Target: TBD   (A/B test after integration)    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                         FILE STRUCTURE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  openclaw-observer/server/                                                  │
│  ├── output-semantic-compression.js                                         │
│  │   └─ Core compression logic (AST, shell analysis, semantic maps)        │
│  │                                                                          │
│  ├── output-semantic-compression.test.js                                    │
│  │   └─ 28 TDD tests validating compression quality & info preservation    │
│  │                                                                          │
│  ├── shell-hook-compression.js                                              │
│  │   └─ Integration adapters (sandbox, tool loop, prompting)               │
│  │                                                                          │
│  └── [EXISTING FILES - WILL BE MODIFIED]                                   │
│      ├── sandbox-io-service.js         (integrate compression)             │
│      ├── observer-execution-runner.js  (use semantic maps)                 │
│      ├── observer-queued-task-prompting.js  (inject context)               │
│      └── observer-worker-prompting.js  (track metrics)                     │
│                                                                             │
│  COMPRESSION_INTEGRATION_GUIDE.md                                           │
│  └─ Detailed implementation guide with examples & troubleshooting          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                    TYPE DETECTION (Auto-Features)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Output Type Detection:                                                      │
│  ─────────────────────                                                      │
│                                                                             │
│  'json'    → Parses structure, counts items, detects errors                │
│  'code'    → AST extracts functions, classes, imports, complexity          │
│  'diff'    → Counts added/removed lines, detects conflicts                 │
│  'file-list' → Groups by extension, counts directories                    │
│  'log'     → Separates by log level, extracts modules, timestamps          │
│  'text'    → Generic analysis, keyword extraction                          │
│                                                                             │
│  Automatic Error Detection:                                                 │
│  ─────────────────────────────                                              │
│  • Regex patterns for common errors (Error:, fatal:, FAIL, [ERR])         │
│  • Extracted error patterns isolated and always included                   │
│  • Never lost during compression (TDD validated)                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
