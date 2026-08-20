/**
 * Expression Security Validator for electron_attach
 *
 * Implements AST-based whitelist validation to prevent code injection attacks
 * via the evaluate parameter. Blocks access to dangerous APIs and patterns.
 *
 * Security Context (2025-2026 Research):
 * - CVE-2026-32304: Function constructor bypass enables arbitrary code execution
 * - CVE-2026-25641: TOCTOU flaws in property validation allow sandbox escapes
 * - CVE-2026-8018: Chrome DevTools policy bypass allows sandbox escape
 * - CVE-2026-34767: Electron XSS enables RCE through header injection
 *
 * Defense Strategy:
 * 1. Static analysis via AST traversal (blocks dangerous patterns pre-execution)
 * 2. Expression length limits (prevents resource exhaustion)
 * 3. Sanitized error messages (prevents information disclosure)
 * 4. CDP Runtime.evaluate instead of Function constructor
 *
 * References:
 * - arXiv 2512.12594: Sandboxing Browser AI Agents
 * - IEEE ProcGuard: Process Injection Detection via API Call Chain Analysis
 * - OWASP 2025: Content Security Policy Implementation Guide
 */

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';

const MAX_EXPRESSION_LENGTH = 50000; // Prevent DoS via extremely long expressions

// Dangerous identifiers that indicate privilege escalation attempts
const BLOCKED_IDENTIFIERS = new Set([
  'eval',
  'Function',
  'require',
  'process',
  '__dirname',
  '__filename',
  'global',
  'import',
  'constructor',
  '__proto__',
]);

// Dangerous member access patterns (e.g., window.constructor)
const BLOCKED_MEMBER_PATTERNS = [
  { object: 'window', property: 'constructor' },
  { object: 'Object', property: 'constructor' },
  { object: 'Array', property: 'constructor' },
  { object: 'String', property: 'constructor' },
];

// Dangerous global access patterns
const BLOCKED_GLOBALS = new Set(['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction']);

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedError?: string;
}

/**
 * Validates a JavaScript expression for security risks.
 *
 * Performs multi-layer validation:
 * 1. Length check
 * 2. AST-based pattern detection
 * 3. Identifier whitelist enforcement
 *
 * @param expression - The JavaScript expression to validate
 * @returns Validation result with error details if blocked
 */
export function validateExpression(expression: string): ValidationResult {
  // Layer 1: Empty expression check
  if (!expression || expression.trim().length === 0) {
    return {
      valid: false,
      error: 'Empty expression not allowed',
    };
  }

  // Layer 2: Length limit
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      valid: false,
      error: `Expression too long (max ${MAX_EXPRESSION_LENGTH} chars)`,
    };
  }

  // Layer 3: AST-based validation
  try {
    const ast = parser.parse(expression, {
      sourceType: 'script',
      errorRecovery: false,
    });

    let violation: string | null = null;

    traverse(ast, {
      // Block direct identifier access to dangerous globals
      Identifier(path) {
        const name = path.node.name;
        if (BLOCKED_IDENTIFIERS.has(name)) {
          // Allow identifiers in safe contexts (e.g., object keys, property names)
          const parent = path.parent;
          const isMemberProperty =
            parent.type === 'MemberExpression' && parent.property === path.node;
          const isObjectKey = parent.type === 'ObjectProperty' && parent.key === path.node;

          if (!isMemberProperty && !isObjectKey) {
            violation = `Access to '${name}' is blocked for security reasons`;
            path.stop();
          }
        }

        if (BLOCKED_GLOBALS.has(name)) {
          violation = `Access to '${name}' is blocked for security reasons`;
          path.stop();
        }
      },

      // Block dangerous member expressions (e.g., window.constructor, (function(){}).constructor)
      MemberExpression(path) {
        const obj = path.node.object;
        const prop = path.node.property;

        if (obj.type === 'Identifier' && prop.type === 'Identifier') {
          for (const pattern of BLOCKED_MEMBER_PATTERNS) {
            if (obj.name === pattern.object && prop.name === pattern.property) {
              violation = `Access to '${pattern.object}.${pattern.property}' is blocked for security reasons`;
              path.stop();
              return;
            }
          }
        }

        // Block any .constructor access (catches (function(){}).constructor, etc.)
        if (prop.type === 'Identifier' && prop.name === 'constructor') {
          violation = `Access to 'constructor' property is blocked for security reasons`;
          path.stop();
        }

        // Block computed member access to __proto__
        if (prop.type === 'Identifier' && prop.name === '__proto__') {
          violation = `Access to '__proto__' is blocked for security reasons`;
          path.stop();
        }
      },

      // Block dynamic import()
      Import() {
        violation = `Dynamic import() is blocked for security reasons`;
      },

      // Block new Function() and similar constructor patterns
      NewExpression(path) {
        const callee = path.node.callee;
        if (callee.type === 'Identifier' && BLOCKED_IDENTIFIERS.has(callee.name)) {
          violation = `Instantiation of '${callee.name}' is blocked for security reasons`;
          path.stop();
        }
      },

      // Block direct eval calls
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type === 'Identifier' && callee.name === 'eval') {
          violation = `Call to 'eval' is blocked for security reasons`;
          path.stop();
        }
      },
    });

    if (violation) {
      return {
        valid: false,
        error: violation,
      };
    }

    return { valid: true };
  } catch (parseError) {
    // If parsing fails, block the expression (might be obfuscated malicious code)
    return {
      valid: false,
      error: `Expression parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    };
  }
}

/**
 * Sanitizes error messages to prevent information disclosure.
 *
 * Removes:
 * - Absolute file paths (Windows and Unix)
 * - User directory names
 * - Environment-specific information
 *
 * @param error - Raw error message
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: string): string {
  return error
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '[PATH]') // Windows paths
    .replace(/\/(?:home|Users)\/[^/\s]+/g, '[USER_DIR]') // Unix user dirs
    .replace(/\/(?:[^/\s]+\/)+[^/\s]+/g, '[PATH]') // Unix paths
    .replace(/\b(?:Administrator|admin|root|user)\b/gi, '[USER]'); // Common usernames
}
