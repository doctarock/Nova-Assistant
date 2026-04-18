/**
 * Shell Hook Compression Integration
 * 
 * Integrates semantic compression into the existing sandbox service layer.
 * Intercepts tool outputs and compresses them before passing to model.
 */

import {
  buildSemanticMap,
  validateSemanticDensity,
  formatSemanticForModel,
  compressShellOutput
} from './output-semantic-compression.js';

/**
 * Wraps sandbox shell execution to add semantic compression
 * Drop-in replacement for existing runSandboxShell, runGatewayShell, etc.
 */
export function createCompressedShellWrapper(originalRunner) {
  return async function runCompressedShell(command, options = {}) {
    // Execute original command
    const result = originalRunner(command, options);
    
    // Compress result before returning
    return compressShellResult(result, command, options);
  };
}

/**
 * Main compression pipeline for shell/tool results
 */
export async function compressShellResult(result = {}, command = "", options = {}) {
  const {
    expectation = "",      // What was supposed to happen
    minDensity = 50,       // Minimum acceptable information density
    stripRaw = false,      // Remove raw output from result
    includeTokens = true   // Include AST tokens in result
  } = options;
  
  const shellOutput = String(result?.stdout || result?.output || result || "");
  const stderr = String(result?.stderr || "");
  
  // Build semantic map for stdout
  const stdoutMap = shellOutput
    ? buildSemanticMap(shellOutput, 'shell-tool', {
        command: command.substring(0, 200),
        outputType: 'text', // Will auto-detect
        expectation
      })
    : null;
  
  // Build semantic map for stderr (if present)
  const stderrMap = stderr
    ? buildSemanticMap(stderr, 'shell-error', {
        command: command.substring(0, 200),
        outputType: 'text'
      })
    : null;
  
  // Validate information preservation
  const validation = stdoutMap
    ? validateSemanticDensity(shellOutput, stdoutMap, minDensity)
    : null;
  
  // Build compressed result
  const compressed = {
    // Semantic maps (high-density, model-ready)
    semantic: {
      output: stdoutMap ? {
        type: stdoutMap.type,
        density: stdoutMap.informationDensity,
        signature: stdoutMap.semanticSignature,
        findings: stdoutMap.keyFindings.slice(0, 5),
        tokens: includeTokens ? stdoutMap.tokens : undefined,
        extracted: stdoutMap.semantic,
        hasError: stdoutMap.hasError,
        errorPattern: stdoutMap.errorPattern,
        executionTime: stdoutMap.executionTime
      } : null,
      errors: stderrMap ? {
        type: stderrMap.type,
        density: stderrMap.informationDensity,
        findings: stderrMap.keyFindings.slice(0, 3),
        extracted: stderrMap.semantic
      } : null
    },
    
    // Validation metrics
    validation: validation
      ? {
          passes: validation.valid,
          densityAcceptable: validation.checks.densityMet,
          errorPreserved: validation.checks.errorPreserved,
          semanticScore: Math.round(validation.score * 100)
        }
      : null,
    
    // Original result (optional - can strip for size)
    raw: !stripRaw ? {
      stdout: shellOutput.substring(0, 2000), // Limit size
      stderr: stderr.substring(0, 1000),
      exitCode: result?.code ?? result?.exitCode ?? 0
    } : undefined,
    
    // Model-ready format (single-line for inline insertion)
    modelFormat: stdoutMap ? formatSemanticForModel(stdoutMap) : "no output"
  };
  
  // If validation fails, include more raw data for debugging
  if (validation && !validation.valid) {
    compressed.raw = {
      stdout: shellOutput,
      stderr: stderr,
      exitCode: result?.code ?? result?.exitCode ?? 0,
      warning: 'Information density below threshold; full output included'
    };
  }
  
  return compressed;
}

/**
 * Higher-order function to wrap tool execution with compression
 * Usage: const compressedTool = compressToolExecution(originalTool)
 */
export function compressToolExecution(originalTool) {
  return async function executedCompressedTool(toolName, args, context = {}) {
    const { expectation = "", stripRaw = false } = context;
    
    // Execute original tool
    const result = await originalTool(toolName, args, context);
    
    // Compress result
    const command = `${toolName} ${JSON.stringify(args).substring(0, 100)}`;
    const compressed = await compressShellResult(result, command, {
      expectation,
      stripRaw,
      minDensity: 45
    });
    
    return compressed;
  };
}

/**
 * Integration point for observer-execution-runner.js
 * Wrap tool loop results with semantic maps for model consumption
 */
export function createToolLoopCompressionAdapter() {
  
  return {
    /**
     * Compress individual tool call results in the loop
     */
    compressToolCallResult(toolName, toolInput, toolOutput, context = {}) {
      const command = `${toolName}(${JSON.stringify(toolInput).substring(0, 100)})`;
      
      const compressed = buildSemanticMap(
        String(toolOutput || ""),
        toolName,
        {
          command,
          outputType: 'text', // Will auto-detect
          targetFile: toolInput?.path || toolInput?.file || "",
          expectation: toolInput?.expectation || context?.expectation || ""
        }
      );
      
      return {
        tool: toolName,
        status: 'executed',
        input: toolInput,
        semantic: compressed,
        // Compact format for model
        summary: {
          type: compressed.type,
          density: compressed.informationDensity,
          hasError: compressed.hasError,
          errorMsg: compressed.errorPattern,
          findings: compressed.keyFindings.slice(0, 3)
        }
      };
    },
    
    /**
     * Build high-density tool loop transcript for model context
     */
    buildToolLoopTranscript(toolCalls = [], maxTokens = 2000) {
      const lines = [];
      let tokenCount = 0;
      
      for (const call of toolCalls) {
        if (tokenCount > maxTokens) break;
        
        const { tool, status, semantic, summary } = call;
        
        // Single-line tool call representation
        let line = `${tool}:${status}(${summary.density}%)`;
        
        if (summary.hasError) {
          line += ` ERROR:${summary.errorMsg}`;
        } else if (summary.findings.length > 0) {
          line += ` [${summary.findings[0].substring(0, 50)}...]`;
        }
        
        lines.push(line);
        tokenCount += line.length / 4; // Rough token estimate
      }
      
      return lines.join('\n');
    },
    
    /**
     * Validate entire tool loop maintains information quality
     */
    validateToolLoopQuality(toolCalls = []) {
      const metrics = {
        totalCalls: toolCalls.length,
        avgDensity: 0,
        errorCalls: 0,
        successCalls: 0,
        semanticsPreserved: true
      };
      
      let densitySum = 0;
      for (const call of toolCalls) {
        const density = call.semantic?.informationDensity || 0;
        densitySum += density;
        
        if (call.summary.hasError) {
          metrics.errorCalls++;
        } else {
          metrics.successCalls++;
        }
      }
      
      metrics.avgDensity = toolCalls.length > 0 
        ? Math.round(densitySum / toolCalls.length)
        : 0;
      
      // Quality threshold
      metrics.qualityMet = metrics.avgDensity >= 50 || metrics.successCalls === toolCalls.length;
      
      return metrics;
    }
  };
}

/**
 * Adapter for buildTaskPrompt (observer-queued-task-prompting.js)
 * Injects compressed semantic context instead of raw tool outputs
 */
export function createTaskPromptCompressionAdapter(originalPromptBuilder) {
  
  return async function buildCompressedTaskPrompt(task, context) {
    // Call original prompt builder
    const originalPrompt = await originalPromptBuilder(task, context);
    
    // Extract tool results from task
    const toolResults = extractToolResults(task);
    
    // Compress each tool result
    const compressedResults = {};
    for (const [toolName, output] of Object.entries(toolResults)) {
      const compressed = buildSemanticMap(output, toolName, {});
      compressedResults[toolName] = {
        semantic: compressed,
        modelLine: formatSemanticForModel(compressed)
      };
    }
    
    // Inject compressed results into prompt
    return injectCompressedContext(originalPrompt, compressedResults);
  };
  
  function extractToolResults(task) {
    const results = {};
    
    if (task?.toolLoopTranscript) {
      // Parse transcript to extract individual tool results
      const matches = task.toolLoopTranscript.match(/Tool: (\w+)[\s\S]*?Result: ([\s\S]*?)(?=Tool:|$)/g) || [];
      matches.forEach(match => {
        const [, name, output] = match.match(/Tool: (\w+)[\s\S]*?Result: ([\s\S]*?)$/m) || [];
        if (name && output) results[name] = output;
      });
    }
    
    if (task?.inspectionResult) {
      results['inspection'] = task.inspectionResult;
    }
    
    return results;
  }
  
  function injectCompressedContext(prompt, compressedResults) {
    let enhanced = prompt;
    
    // Build dense context section
    const contextLines = [
      '\n## Semantic Context (High-Density Information Maps)',
      '```'
    ];
    
    for (const [tool, { modelLine }] of Object.entries(compressedResults)) {
      contextLines.push(`${tool}: ${modelLine}`);
    }
    
    contextLines.push('```\n');
    
    // Insert before task description
    enhanced = enhanced.replace(
      /^## Task/m,
      contextLines.join('\n') + '## Task'
    );
    
    return enhanced;
  }
}

/**
 * Metrics collection for monitoring compression effectiveness
 */
export class CompressionMetrics {
  constructor() {
    this.compressions = [];
    this.totalOriginalSize = 0;
    this.totalCompressedSize = 0;
  }
  
  recordCompression(original, compressed) {
    const originalSize = JSON.stringify(original).length;
    const compressedSize = JSON.stringify(compressed).length;
    const ratio = originalSize > 0 ? compressedSize / originalSize : 0;
    
    this.compressions.push({
      timestamp: Date.now(),
      originalSize,
      compressedSize,
      ratio,
      density: compressed.semantic?.density || 0
    });
    
    this.totalOriginalSize += originalSize;
    this.totalCompressedSize += compressedSize;
  }
  
  getStats() {
    const compressions = this.compressions;
    const avgRatio = compressions.length > 0
      ? compressions.reduce((sum, c) => sum + c.ratio, 0) / compressions.length
      : 0;
    const avgDensity = compressions.length > 0
      ? compressions.reduce((sum, c) => sum + c.density, 0) / compressions.length
      : 0;
    
    return {
      totalCompressions: compressions.length,
      avgCompressionRatio: avgRatio.toFixed(2),
      avgInformationDensity: Math.round(avgDensity) + '%',
      totalSizeSavings: this.totalOriginalSize - this.totalCompressedSize,
      totalSizeSavingsPercent: this.totalOriginalSize > 0
        ? Math.round(((this.totalOriginalSize - this.totalCompressedSize) / this.totalOriginalSize) * 100) + '%'
        : '0%'
    };
  }
}

/**
 * Example integration with existing observer system:
 * 
 * In observer-execution-runner.js:
 * 
 * import { createToolLoopCompressionAdapter } from './shell-hook-compression.js';
 * const compressionAdapter = createToolLoopCompressionAdapter();
 * 
 * // In tool loop:
 * const compressedResult = compressionAdapter.compressToolCallResult(
 *   toolName,
 *   toolInput,
 *   toolOutput,
 *   { expectation: 'list files in directory' }
 * );
 * 
 * // Build transcript with compressed results
 * const transcript = compressionAdapter.buildToolLoopTranscript(toolCalls);
 * 
 * // Add to task context
 * task.compressedToolContext = transcript;
 * 
 * // Validate quality
 * const quality = compressionAdapter.validateToolLoopQuality(toolCalls);
 * if (!quality.qualityMet) {
 *   console.warn('Tool loop quality below threshold:', quality);
 * }
 */

export default {
  createCompressedShellWrapper,
  compressShellResult,
  compressToolExecution,
  createToolLoopCompressionAdapter,
  createTaskPromptCompressionAdapter,
  CompressionMetrics
};
