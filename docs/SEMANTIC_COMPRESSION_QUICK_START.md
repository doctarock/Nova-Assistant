# Semantic Compression Quick Start

## What Was Added ✅

Two utility functions were added to `server.js` and exported in `runtimeRouteArgs`:

### 1. `getToolResultSemantic(toolResult, toolName, defaultOutput)`

**Purpose:** Extract semantic compression from any tool result

**Usage:**
```javascript
// Inside observer-execution-runner.js or similar
const { getToolResultSemantic } = runtimeRouteArgs;

// After getting a tool result:
const result = await executeTool(toolName, toolInput);

// Extract semantic version (or raw as fallback)
const semanticOutput = getToolResultSemantic(result, toolName);

// Now semanticOutput contains:
// - Either the __semantic map if available
// - Or original stdout if stdout exists
// - Or defaultOutput fallback
```

### 2. `formatToolResultForModel(toolName, toolInput, toolOutput)`

**Purpose:** Format tool results for model consumption with compression

**Usage:**
```javascript
// Inside prompting layer
const { formatToolResultForModel } = runtimeRouteArgs;

const formattedResult = formatToolResultForModel(
  'list_files',
  { path: '/src' },
  toolOutput  // Raw stdout from tool
);

// Returns object with:
// {
//   tool: 'list_files',
//   modelFormat: '<compressed format>',  // High-density text for model
//   density: 0.85,                       // Information density (0-1)
//   findings: [...]                      // Top 3 key findings
// }

// Then pass modelFormat to model instead of raw output
```

## System Integration Points

### Already Done ✅
1. **Sandbox I/O** (`sandbox-io-service.js`)
   - All shell commands via `runGatewayShell()` automatically get semantic compression
   - Metadata attached as `__semantic`, `__modelFormat`, `__validation`

2. **Server Bootstrap** (`server.js`)
   - Utilities exported and available to all route handlers
   - No code changes required to access them

### To Do Next

#### Option A: Tool Loop (Minimal Impact)
```javascript
// In observer-execution-runner.js
const toolResult = await executeTool(...);
const formatted = formatToolResultForModel(toolName, input, toolResult.stdout);
// Use formatted.modelFormat instead of raw stdout
```

#### Option B: Prompt Building
```javascript
// In observer-queued-task-prompting.js
toolCalls.forEach(call => {
  const compressed = getToolResultSemantic(call.result, call.tool);
  // Inject into transcript instead of raw output
});
```

#### Option C: Advanced Monitoring
```javascript
// Track density across all tool calls
const metrics = {
  totalTools: 0,
  avgDensity: 0,
  lowDensity: []
};

toolResults.forEach(result => {
  const formatted = formatToolResultForModel(name, input, output);
  metrics.totalTools++;
  metrics.avgDensity += formatted.density;
  if (formatted.density < 0.7) {
    metrics.lowDensity.push({ tool: name, density: formatted.density });
  }
});
```

## How to Verify It's Working

### Test 1: Check Shell Compression
```javascript
// In any route handler with access to runtimeRouteArgs
const { getToolResultSemantic } = runtimeRouteArgs;

// Execute a shell command
const result = await someShellCommand();

// Check if semantic map is attached
if (result.__semantic) {
  console.log('✅ Semantic compression is working!');
  console.log('Density:', result.__semantic.informationDensity);
  console.log('Key findings:', result.__semantic.keyFindings);
} else {
  console.log('❌ No semantic compression attached');
}
```

### Test 2: Format and Compare
```javascript
const { formatToolResultForModel } = runtimeRouteArgs;

const raw = result.stdout;  // Original output
const formatted = formatToolResultForModel('mytool', input, raw);

console.log('Raw length:', raw.length);
console.log('Formatted length:', formatted.modelFormat.length);
console.log('Compression ratio:', 
  (1 - formatted.modelFormat.length / raw.length).toFixed(2));
console.log('Info density:', formatted.density.toFixed(2));
```

## Available Props in Semantic Map

When `__semantic` is attached (from `compressShellResult`):
```javascript
{
  outputType: 'code|json|diff|file-list|log|text',
  informationDensity: 0.0-1.0,
  keyFindings: [...],
  compressedLines: [...],
  errorLines: [...],
  hasJsonContent: boolean,
  hasCodeContent: boolean,
  summary: string
}
```

## Fallback Behavior

Both utilities are **backward compatible**:

- `getToolResultSemantic()` falls back to raw output if no semantic map
- `formatToolResultForModel()` works with any raw output string
- Existing code continues to work unchanged

No breaking changes. Gradual adoption path.

## Next Steps

1. **For Developers:** Use these utilities in the tool loop to pass compressed output to models
2. **For Testing:** Run `node server/output-semantic-compression.test.js` to verify all 28 tests pass
3. **For Monitoring:** Track `density` values across tool calls to measure effectiveness

## Questions?

Refer to these files:
- [output-semantic-compression.js](./output-semantic-compression.js) - Core engine
- [shell-hook-compression.js](./shell-hook-compression.js) - Integration patterns
- [COMPRESSION_IMPLEMENTATION_GUIDE.md](./COMPRESSION_IMPLEMENTATION_GUIDE.md) - Detailed guide
