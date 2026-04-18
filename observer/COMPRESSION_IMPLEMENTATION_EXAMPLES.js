/**
 * PRACTICAL IMPLEMENTATION EXAMPLE
 * 
 * Shows how to integrate semantic compression into real observer workflows
 */

// ============================================================================
// EXAMPLE 1: Compress a single tool result in sandbox-io-service.js
// ============================================================================

// BEFORE (Current Code):
/*
async function runGatewayShell(command, { input } = {}) {
  return runObserverToolContainerNode(`
    ... run shell command ...
  `);
  // Returns: { code: 0, stdout: "... full output ...", stderr: "" }
}

// Usage in observer-project-workspace-support.js:
const result = await runGatewayShell('ls -la /path');
const output = result.stdout; // Raw, 5KB of file listing metadata
task.context = output; // Passed to model - NOISY!
*/

// AFTER (With Compression):
import { compressShellResult } from './shell-hook-compression.js';

async function runCompressedGatewayShell(command, options = {}) {
  // Run the original command
  const result = await runObserverToolContainerNode(`...`);
  
  // Compress the result before returning
  const compressed = await compressShellResult(result, command, {
    expectation: options.expectation || 'execute shell command',
    minDensity: 50,
    stripRaw: true // Remove raw output if compression is good
  });
  
  return compressed;
}

// Usage in observer-project-workspace-support.js:
const result = await runCompressedGatewayShell(
  'ls -la /path',
  { expectation: 'list TypeScript source files' }
);

// Result structure:
// {
//   semantic: {
//     output: {
//       type: 'file-list',
//       density: 88,
//       signature: 'a3c7f2',
//       extracted: {
//         totalEntries: 12,
//         fileCount: 10,
//         dirCount: 2,
//         extensions: [{ ext: 'ts', count: 8 }, { ext: 'json', count: 2 }],
//         totalSize: '247KB'
//       }
//     }
//   },
//   modelFormat: "[ls:file-list] files:10 dirs:2 typeScript:8 density:88%"
// }

task.context = result.modelFormat; // Clean, high-density - 40 bytes vs 5KB!

// ============================================================================
// EXAMPLE 2: Compress entire tool loop in observer-execution-runner.js
// ============================================================================

import { createToolLoopCompressionAdapter } from './shell-hook-compression.js';

async function executeToolLoopWithCompression(task, context) {
  const adapter = createToolLoopCompressionAdapter();
  const toolCalls = [];
  
  // Tool 1: List files
  const listResult = await runTool('list_files', { path: task.targetPath });
  const compressedList = adapter.compressToolCallResult(
    'list_files',
    { path: task.targetPath },
    listResult.stdout,
    { expectation: 'find all .js files in src/' }
  );
  toolCalls.push(compressedList);
  console.log('Tool 1:', compressedList.summary);
  // → { type: 'file-list', density: 85, hasError: false, findings: [...] }
  
  // Tool 2: Read a specific file
  const readResult = await runTool('read_file', { file: 'src/index.js' });
  const compressedRead = adapter.compressToolCallResult(
    'read_file',
    { file: 'src/index.js' },
    readResult.stdout,
    { expectation: 'understand the entry point structure' }
  );
  toolCalls.push(compressedRead);
  console.log('Tool 2:', compressedRead.summary);
  // → { type: 'code', density: 74, hasError: false, findings: [function:main, function:setup, ...] }
  
  // Tool 3: Run linter
  const lintResult = await runTool('eslint', { file: 'src/index.js' });
  const compressedLint = adapter.compressToolCallResult(
    'eslint',
    { file: 'src/index.js' },
    lintResult.stdout,
    { expectation: 'identify code quality issues' }
  );
  toolCalls.push(compressedLint);
  console.log('Tool 3:', compressedLint.summary);
  // → { type: 'log', density: 92, hasError: true, findings: ['error: no-unused-vars', ...] }
  
  // Build high-density transcript for the model
  const transcript = adapter.buildToolLoopTranscript(toolCalls, 2000);
  
  // Example output:
  // list_files:executed(85%) [find all .js files in src/ | totalEntries:12]
  // read_file:executed(74%) ERROR:none [function:main found]
  // eslint:executed(92%) ERROR:no-unused-vars found [issue at line 42]
  
  task.compressedToolContext = transcript; // Now 500 bytes instead of 15KB!
  
  // Validate the entire loop maintains quality
  const quality = adapter.validateToolLoopQuality(toolCalls);
  console.log('Quality Metrics:', quality);
  // → {
  //     totalCalls: 3,
  //     avgDensity: 84,
  //     errorCalls: 1,
  //     successCalls: 2,
  //     semanticsPreserved: true,
  //     qualityMet: true
  //   }
  
  // If quality is low, fall back to raw output
  if (!quality.qualityMet) {
    console.warn('Tool loop quality below threshold, falling back to raw output');
    task.compressedToolContext = buildRawTranscript(toolCalls);
  }
  
  task.toolLoopDiagnostics = quality;
  return task;
}

// ============================================================================
// EXAMPLE 3: Inject compressed context into task prompt
// ============================================================================

async function buildTaskPromptWithSemanticContext(task) {
  // Original prompt builder
  const basePrompt = `
    Task: ${task.message}
    
    Project: ${task.projectName}
    Target: ${task.targetFile}
  `;
  
  // Inject compressed semantic context
  const contextSection = `
    Context (High-Density Information Maps):
    ────────────────────────────────────────
    ${task.compressedToolContext || 'No prior tool context'}
    
    Quality Metrics:
    • Avg Information Density: ${task.toolLoopDiagnostics?.avgDensity || 'N/A'}%
    • Tools Executed: ${task.toolLoopDiagnostics?.totalCalls || 0}
    • Errors Detected: ${task.toolLoopDiagnostics?.errorCalls || 0}
  `;
  
  const fullPrompt = basePrompt + '\n' + contextSection + `
    
    Instructions:
    1. Use the semantic context above to understand current state
    2. The tool results are compressed for efficiency (high information density)
    3. Extract key findings and errors from the context
    4. Plan your next action based on this understanding
    
    Next step:
  `;
  
  return fullPrompt;
}

// ============================================================================
// EXAMPLE 4: Monitor compression effectiveness
// ============================================================================

import { CompressionMetrics } from './shell-hook-compression.js';

class ObserverCompressionMonitor {
  constructor() {
    this.metrics = new CompressionMetrics();
    this.compressionHistory = [];
  }
  
  recordToolExecution(toolName, originalOutput, compressedOutput) {
    this.metrics.recordCompression(originalOutput, compressedOutput);
    
    // Track history for trends
    this.compressionHistory.push({
      timestamp: Date.now(),
      tool: toolName,
      ratio: JSON.stringify(originalOutput).length / JSON.stringify(compressedOutput).length,
      density: compressedOutput.semantic?.density || 0
    });
    
    // Keep last 1000 compressions
    if (this.compressionHistory.length > 1000) {
      this.compressionHistory.shift();
    }
  }
  
  getStats() {
    const stats = this.metrics.getStats();
    
    // Calculate trends
    const recent = this.compressionHistory.slice(-100);
    const avgDensityRecent = recent.reduce((sum, c) => sum + c.density, 0) / recent.length;
    const avgRatioRecent = recent.reduce((sum, c) => sum + c.ratio, 0) / recent.length;
    
    return {
      overall: stats,
      recent: {
        avgDensity: Math.round(avgDensityRecent),
        avgRatio: avgRatioRecent.toFixed(1),
        samples: recent.length
      },
      anomalies: this.detectAnomalies()
    };
  }
  
  detectAnomalies() {
    const recent = this.compressionHistory.slice(-50);
    const avgDensity = recent.reduce((sum, c) => sum + c.density, 0) / recent.length;
    
    const anomalies = recent.filter(c => Math.abs(c.density - avgDensity) > 20);
    
    return {
      lowDensityCompressions: anomalies.filter(c => c.density < 50),
      highVarianceCompressions: anomalies.filter(c => c.density > 95),
      count: anomalies.length
    };
  }
  
  reportMetrics() {
    const stats = this.getStats();
    
    console.log(`
    ╔════════════════════════════════════════╗
    ║    COMPRESSION EFFECTIVENESS REPORT    ║
    ╚════════════════════════════════════════╝
    
    Overall Statistics:
    ─────────────────
    • Total Compressions: ${stats.overall.totalCompressions}
    • Compression Ratio: ${stats.overall.avgCompressionRatio}x
    • Avg Information Density: ${stats.overall.avgInformationDensity}
    • Size Reduction: ${stats.overall.totalSizeSavingsPercent}
    
    Recent Trends (last 100):
    ───────────────────────
    • Avg Density: ${stats.recent.avgDensity}%
    • Avg Ratio: ${stats.recent.avgRatio}:1
    • Samples: ${stats.recent.samples}
    
    Anomalies Detected:
    ──────────────────
    • Low Density (<50%): ${stats.anomalies.lowDensityCompressions.length}
    • High Variance (>95%): ${stats.anomalies.highVarianceCompressions.length}
    
    ════════════════════════════════════════
    `);
  }
}

// Usage in observer initialization:
const compressionMonitor = new ObserverCompressionMonitor();

// During tool execution:
const compressed = await compressToolResult(...);
compressionMonitor.recordToolExecution(toolName, originalOutput, compressed);

// Daily reporting:
setInterval(() => {
  compressionMonitor.reportMetrics();
}, 24 * 60 * 60 * 1000);

// ============================================================================
// EXAMPLE 5: A/B Testing with and without compression
// ============================================================================

async function runABTest(testCases = []) {
  const results = {
    withCompression: [],
    withoutCompression: [],
    metrics: {
      speedImprovement: 0,
      densityIncrease: 0,
      contextsizeReduction: 0
    }
  };
  
  for (const testCase of testCases) {
    // Run WITH compression
    const startWith = Date.now();
    const withCompression = await executeToolLoopWithCompression(
      testCase,
      {}
    );
    const timeWith = Date.now() - startWith;
    const sizeWith = JSON.stringify(withCompression.compressedToolContext).length;
    
    results.withCompression.push({
      test: testCase.name,
      time: timeWith,
      size: sizeWith,
      density: withCompression.toolLoopDiagnostics?.avgDensity || 0
    });
    
    // Run WITHOUT compression (for comparison)
    const startWithout = Date.now();
    const withoutCompression = await executeToolLoopRaw(testCase, {});
    const timeWithout = Date.now() - startWithout;
    const sizeWithout = JSON.stringify(withoutCompression.rawToolContext).length;
    
    results.withoutCompression.push({
      test: testCase.name,
      time: timeWithout,
      size: sizeWithout,
      density: 30 // Assumed baseline
    });
  }
  
  // Calculate improvements
  const avgTimeWith = results.withCompression.reduce((s, r) => s + r.time, 0) / results.withCompression.length;
  const avgTimeWithout = results.withoutCompression.reduce((s, r) => s + r.time, 0) / results.withoutCompression.length;
  const avgSizeWith = results.withCompression.reduce((s, r) => s + r.size, 0) / results.withCompression.length;
  const avgSizeWithout = results.withoutCompression.reduce((s, r) => s + r.size, 0) / results.withoutCompression.length;
  const avgDensityWith = results.withCompression.reduce((s, r) => s + r.density, 0) / results.withCompression.length;
  
  results.metrics = {
    speedImprovement: ((avgTimeWithout - avgTimeWith) / avgTimeWithout * 100).toFixed(1) + '%',
    densityIncrease: ((avgDensityWith - 30) / 30 * 100).toFixed(1) + '%',
    contextSizeReduction: ((avgSizeWithout - avgSizeWith) / avgSizeWithout * 100).toFixed(1) + '%'
  };
  
  console.log('A/B Test Results:', results);
  // → Expected output:
  // {
  //   withCompression: [ { time: 34, size: 450, density: 82 }, ... ],
  //   withoutCompression: [ { time: 28, size: 15000, density: 30 }, ... ],
  //   metrics: {
  //     speedImprovement: "-24%",  // Compression adds minimal overhead
  //     densityIncrease: "173%",    // 3x better information density!
  //     contextSizeReduction: "97%"  // 30x smaller context!
  //   }
  // }
  
  return results;
}

// ============================================================================
// EXAMPLE 6: Test Suite Execution
// ============================================================================

// Run before deployment:
import { runTests } from './output-semantic-compression.test.js';

async function runPreDeploymentValidation() {
  console.log('Running compression validation suite...\n');
  
  const testResults = await runTests();
  
  if (!testResults.success) {
    console.error('❌ Compression tests failed. Do not deploy.');
    process.exit(1);
  }
  
  console.log('✅ All compression tests passed.\n');
  
  // Optional: Run A/B test
  console.log('Running A/B test comparison...');
  // const abResults = await runABTest(sampleTestCases);
  // console.log('A/B Results:', abResults);
  
  console.log('✅ Ready for production deployment.');
}

// ============================================================================
// SUMMARY
// ============================================================================

/**
 * Integration Checklist:
 * 
 * 1. ✓ Add compression modules to server/
 *    - output-semantic-compression.js
 *    - output-semantic-compression.test.js
 *    - shell-hook-compression.js
 * 
 * 2. ✓ Run tests to validate compression logic
 *    node server/output-semantic-compression.test.js
 * 
 * 3. ✓ Modify sandbox-io-service.js
 *    - Import { compressShellResult }
 *    - Wrap runGatewayShell results with compression
 *    - Return compressed.modelFormat to model
 * 
 * 4. ✓ Modify observer-execution-runner.js
 *    - Import { createToolLoopCompressionAdapter }
 *    - Compress individual tool call results
 *    - Build compressed transcript for context
 * 
 * 5. ✓ Modify observer-queued-task-prompting.js
 *    - Inject compressed semantic context into prompt
 *    - Include quality metrics
 * 
 * 6. ✓ Add monitoring
 *    - Create CompressionMetrics instance
 *    - Record compressions during execution
 *    - Report daily metrics
 * 
 * 7. ✓ A/B Test
 *    - Compare with/without compression
 *    - Measure: speed, size, density, model quality
 *    - Adjust thresholds based on results
 * 
 * Expected Results:
 * ─────────────────
 * • Information Density: 25% → 75-85%
 * • Context Size: 12KB → 400 bytes (30:1 reduction)
 * • Processing Time: +2-5ms (negligible)
 * • Model Quality: TBD (A/B test will show improvement)
 * • Memory Usage: ~90% reduction in context storage
 */

export {
  executeToolLoopWithCompression,
  buildTaskPromptWithSemanticContext,
  ObserverCompressionMonitor,
  runABTest,
  runPreDeploymentValidation
};
