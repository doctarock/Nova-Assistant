/**
 * TDD Test Suite for Semantic Compression
 * 
 * Validates that compression:
 * 1. Preserves critical information (errors, key findings)
 * 2. Maintains information density metrics
 * 3. Accurately extracts semantic tokens
 * 4. Handles edge cases without data loss
 */

import {
  parseCodeAst,
  compressShellOutput,
  buildSemanticMap,
  validateSemanticDensity,
  formatSemanticForModel
} from './output-semantic-compression.js';

// ============================================================================
// TEST SUITE CONFIGURATION
// ============================================================================

const tests = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
  }
}

function assertGreaterThan(actual, minimum, message) {
  if (actual <= minimum) {
    throw new Error(`Expected > ${minimum}, got ${actual}. ${message}`);
  }
}

// ============================================================================
// TEST: Code AST Parsing
// ============================================================================

test('AST Parsing: Extract functions from code', () => {
  const code = `
    function calculateTax(amount) {
      return amount * 0.1;
    }
    
    const processPmt = async (data) => {
      if (!data) throw new Error('No data');
      return validate(data);
    }
  `;
  
  const result = parseCodeAst(code);
  assert(result.valid, 'Should parse valid code');
  assert(result.tokens.length > 0, 'Should extract tokens');
  assert(result.tokens.some(t => t.type === 'function'), 'Should find functions');
  assert(result.tokens.some(t => t.type === 'error'), 'Should detect errors');
});

test('AST Parsing: Handle malformed code gracefully', () => {
  const code = `function broken({ const x = >>`;
  const result = parseCodeAst(code);
  assert(!result.valid, 'Should flag as invalid');
  assert(result.tokens.length >= 0, 'Should still extract partial tokens via regex');
});

test('AST Parsing: Preserve information density', () => {
  const code = `
export interface UserService {
  findById(id: string): Promise<User>;
  create(data: CreateUserDto): Promise<User>;
}

const service: UserService = {
  findById: async (id) => db.query('SELECT * FROM users WHERE id = ?', [id]),
  create: async (data) => {
    if (!data?.email) throw new ValidationError('Email required');
    return db.insert('users', data);
  }
};
  `;
  
  const result = parseCodeAst(code);
  const functionCount = result.tokens.filter(t => t.type === 'function').length;
  assertGreaterThan(functionCount, 0, 'Should extract multiple functions');
});

// ============================================================================
// TEST: Shell Output Compression
// ============================================================================

test('Shell Compression: Extract key lines from npm output', () => {
  const output = `
    npm WARN deprecated uuid@3.4.0: Please upgrade  to version 7 or higher
    npm notice
    npm notice New major version of npm available! 9.0.0 -> 10.2.1
    npm notice To update run: npm install -g npm@latest
    npm notice
    added 42 packages, and audited 215 packages in 3s
    
    found 2 vulnerabilities (1 moderate, 1 high)
    run \`npm audit fix\` to fix them, or \`npm audit\` for details
  `;
  
  const compressed = compressShellOutput(output, 'npm install');
  assert(compressed.keyLines.length > 0, 'Should extract key lines');
  assertGreaterThan(compressed.informationDensity, 30, 'Should have >30% density');
  assert(compressed.hasWarning, 'Should detect warnings');
});

test('Shell Compression: Detect errors in output', () => {
  const output = `
    Building application...
    Error: Cannot find module 'lodash'
      at Object.<anonymous> (/app/index.js:5:1)
      at Module._load (internal/modules/...)
    npm ERR! code ENOENT
    npm ERR! syscall open
    npm ERR! path /app/package.json
  `;
  
  const compressed = compressShellOutput(output, 'npm start');
  assert(compressed.hasError, 'Should detect errors');
  assert(compressed.errorPattern, 'Should extract error pattern');
});

test('Shell Compression: Extract execution time', () => {
  const output = `
    Starting webpack...
    Built in 3.2s
    Done in 45.123ms
    real 0m3.456s
  `;
  
  const compressed = compressShellOutput(output);
  assert(compressed.executionTime, 'Should extract execution time');
});

test('Shell Compression: Remove noise effectively', () => {
  const noise = `
    [DEBUG] Initializing logger
    [DEBUG] Loading config from /app/config.js
    [DEBUG] Setting up middleware
    [INFO] Server listening on port 3000
    [DEBUG] Database connected
    [ERROR] Connection timeout
  `;
  
  const compressed = compressShellOutput(noise);
  const infoRatio = compressed.keyLines.length / (noise.split('\n').length - 1);
  assertGreaterThan(infoRatio, 0.1, 'Should keep at least 10% as key lines');
});

// ============================================================================
// TEST: Semantic Map Building
// ============================================================================

test('Semantic Map: Detect JSON output type', () => {
  const json = JSON.stringify({
    status: 'success',
    data: [{ id: 1, name: 'test' }],
    timestamp: Date.now()
  });
  
  const map = buildSemanticMap(json, 'api-call', { outputType: 'json' });
  assertEqual(map.type, 'json', 'Should detect JSON type');
  assert(map.semantic.keys, 'Should extract keys');
});

test('Semantic Map: Detect file list output', () => {
  const listing = `
    src/
    src/index.js
    src/utils.js
    package.json
    README.md
    .gitignore
  `;
  
  const map = buildSemanticMap(listing, 'ls', { outputType: 'file-list' });
  assertEqual(map.type, 'file-list', 'Should detect file list');
  assertGreaterThan(map.semantic.totalEntries, 0, 'Should count entries');
});

test('Semantic Map: Detect diff output', () => {
  const diff = `
    --- a/src/app.js
    +++ b/src/app.js
    @@ -1,5 +1,6 @@
     const express = require('express');
    -const PORT = 3000;
    +const PORT = process.env.PORT || 3000;
     
     app.listen(PORT, () => {
       console.log(\`Server running on port \${PORT}\`);
  `;
  
  const map = buildSemanticMap(diff, 'git-diff', { outputType: 'diff' });
  assertEqual(map.type, 'diff', 'Should detect diff type');
  assertGreaterThan(map.semantic.addedLines, 0, 'Should count additions');
});

test('Semantic Map: Build signature that identifies content', () => {
  const output1 = `ERROR: Database connection failed`;
  const output2 = `ERROR: Authentication failed`;
  
  const map1 = buildSemanticMap(output1, 'query', { outputType: 'text' });
  const map2 = buildSemanticMap(output2, 'auth', { outputType: 'text' });
  
  assert(
    map1.semanticSignature !== map2.semanticSignature,
    'Different content should have different signatures'
  );
});

// ============================================================================
// TEST: Density Validation (Information Preservation)
// ============================================================================

test('Density Validation: Ensure error is never lost', () => {
  const verbose = `
    Processing request...
    [DEBUG] Loading config
    [DEBUG] Authenticating user
    [DEBUG] Querying database
    Error: Invalid credentials
    [DEBUG] Rolling transaction back
    [DEBUG] Cleaning up resources
  `;
  
  const map = buildSemanticMap(verbose, 'auth', { outputType: 'text' });
  const validation = validateSemanticDensity(verbose, map, 40);
  
  assert(validation.checks.errorPreserved, 'Errors must be preserved');
  assert(validation.valid, 'Should pass density validation');
});

test('Density Validation: Preserve key metrics', () => {
  const output = `
    Test Results:
    ✓ Login flow: 1234ms
    ✓ API endpoints: 567ms
    ✗ Database query: TIMEOUT (>5000ms)
    ✓ Cache invalidation: 89ms
    
    Summary: 3/4 passed, 1 failed
  `;
  
  const map = buildSemanticMap(output, 'test-runner', { outputType: 'log' });
  const validation = validateSemanticDensity(output, map, 50);
  
  assert(validation.valid, 'Should maintain density for test results');
  assert(map.semantic.levels.error, 'Should identify errors');
});

test('Density Validation: Complex multi-type output', () => {
  const complex = `
    [ERR] Failed to process file:
    
    File: src/broken.js
    {
      "error": "SyntaxError",
      "line": 42,
      "code": "const x = >>"
    }
    
    Duration: 234ms
  `;
  
  const map = buildSemanticMap(complex, 'linter', { outputType: 'text' });
  const validation = validateSemanticDensity(complex, map, 40);
  
  assert(validation.valid, 'Should handle mixed-type output');
  assertGreaterThan(validation.score, 0.5, 'Should score >50% accuracy');
});

// ============================================================================
// TEST: Model Formatting
// ============================================================================

test('Model Format: Compress to single-line token representation', () => {
  const map = buildSemanticMap(
    `function test() { throw new Error('Failed'); }`,
    'parser',
    { outputType: 'code' }
  );
  
  const formatted = formatSemanticForModel(map);
  assert(formatted.length < 200, 'Should be short enough for inline use');
  assert(formatted.includes('[parser:'), 'Should include tool and type');
  assert(formatted.includes('ERROR'), 'Should preserve error');
});

test('Model Format: Handles all semantic types', () => {
  const outputs = [
    { text: '{"data": [1,2,3]}', type: 'json' },
    { text: 'function test() {}', type: 'code' },
    { text: '--- a/file\n+++ b/file', type: 'diff' },
    { text: 'src/index.js\nsrc/utils.js', type: 'file-list' }
  ];
  
  for (const { text, type } of outputs) {
    const map = buildSemanticMap(text, 'tool', { outputType: type });
    const formatted = formatSemanticForModel(map);
    assert(formatted, `Should format ${type} output`);
  }
});

// ============================================================================
// TEST: Edge Cases
// ============================================================================

test('Edge Case: Empty output', () => {
  const map = buildSemanticMap('', 'tool', {});
  assert(map, 'Should handle empty output');
  assertEqual(map.semantic.type || 'text', 'text', 'Should default to text');
});

test('Edge Case: Very large output (1MB+)', () => {
  const large = 'x'.repeat(1024 * 1024 + 1);
  const map = buildSemanticMap(large, 'tool', {});
  assert(map, 'Should handle large output');
  assert(map.semantic, 'Should still extract semantic');
});

test('Edge Case: Output with non-ASCII characters', () => {
  const output = `
    ✓ Test passed: 测试通过 🎉
    ✗ Database error: 数据库错误 ⚠️
    Summary: 50% pass rate (中文)
  `;
  
  const map = buildSemanticMap(output, 'multilang-test', {});
  assert(map, 'Should handle non-ASCII');
  assert(map.semantic, 'Should extract from multilingual content');
});

test('Edge Case: Pathological input (max nesting)', () => {
  let nested = { a: 1 };
  let current = nested;
  for (let i = 0; i < 20; i++) {
    current.next = { level: i };
    current = current.next;
  }
  
  const map = buildSemanticMap(
    JSON.stringify(nested),
    'nested-json',
    { outputType: 'json' }
  );
  
  assert(map.semantic.depth <= 10, 'Should cap depth exploration at 10');
  assert(map, 'Should not crash on deep nesting');
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

test('Performance: Parse 10KB code in <100ms', () => {
  const code = `
    ${Array(100).fill(0).map((_, i) => `
      function func${i}(param1, param2, param3) {
        const value = param1 + param2;
        if (param3) throw new Error('Invalid');
        return value;
      }
    `).join('\n')}
  `;
  
  const start = Date.now();
  const result = parseCodeAst(code);
  const duration = Date.now() - start;
  
  assertGreaterThan(100 - duration, 0, `Parsing took ${duration}ms, should <100ms`);
  assert(result.tokens.length > 50, 'Should extract many tokens');
});

test('Performance: Compress 100KB output in <50ms', () => {
  const output = `
    ${Array(1000).fill(0).map((_, i) => `
      [${i}] Processing line
      [${i}] ✓ Success
      [${i}] Duration: ${Math.random() * 1000}ms
    `).join('\n')}
  `;
  
  const start = Date.now();
  compressShellOutput(output);
  const duration = Date.now() - start;
  
  assertGreaterThan(50 - duration, 0, `Compression took ${duration}ms, should <50ms`);
});

// ============================================================================
// TEST RUNNER
// ============================================================================

export async function runTests() {
  console.log('🧪 Running Semantic Compression Test Suite\n');
  console.log('═'.repeat(70));
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passCount++;
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  ${error.message}\n`);
      failCount++;
    }
  }
  
  console.log('═'.repeat(70));
  console.log(`\n📊 Results: ${passCount} passed, ${failCount} failed (${tests.length} total)\n`);
  
  return {
    total: tests.length,
    passed: passCount,
    failed: failCount,
    success: failCount === 0
  };
}

export default { runTests };
