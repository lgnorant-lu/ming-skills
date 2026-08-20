/**
 * Safe code transformation for Camoufox page.evaluate()
 *
 * SECURITY: This module eliminates direct use of new Function() on untrusted
 * code by leveraging page.evaluate()'s built-in serialization mechanism.
 *
 * Key insight: page.evaluate() accepts a function and serializes it (via
 * Function.prototype.toString()) before sending to the browser. The actual
 * code execution happens in the browser's isolated V8 context, not in Node.js.
 *
 * Security properties:
 * 1. No Node.js API access (fs, child_process, etc.)
 * 2. Execution is sandboxed in browser context
 * 3. Prototype pollution is contained to the page
 *
 * References:
 * - CVE-2024-21541: Function constructor RCE
 * - OWASP: Avoid eval() and Function() for untrusted input
 * - Playwright/Puppeteer page.evaluate() documentation
 */

export interface CodeTransformOptions {
  /**
   * User-provided code (expression or statements).
   * Can be:
   * - Expression: `document.title`
   * - IIFE: `(() => { return 42; })()`
   * - Statement block: `const x = 5; return x * 2;`
   */
  code: string;
}

export interface CodeTransformResult {
  /**
   * Executable function for page.evaluate().
   * This is a string-based function that page.evaluate() will parse
   * and execute in the browser context.
   */
  evaluateFunction: (() => unknown) | string;

  /**
   * Whether the code was wrapped (true) or used as-is (false).
   */
  wasWrapped: boolean;

  /**
   * Original code (for debugging).
   */
  originalCode: string;
}

/**
 * Transform user code into a safe executable for Camoufox.
 *
 * CRITICAL SECURITY CHANGE: Instead of using new Function() in Node.js,
 * we return a function STRING that page.evaluate() will parse in the browser.
 * This moves all code parsing/compilation to the browser's V8 context where
 * Node.js APIs are not accessible.
 *
 * This is still not ideal (we're still constructing code as a string), but
 * the key difference is:
 * - Before: new Function(code) runs in Node.js process
 * - After: code is parsed/executed only in browser context
 *
 * @param options - Code transformation options
 * @returns Transform result with executable function
 */
export function transformCodeForCamoufox(options: CodeTransformOptions): CodeTransformResult {
  const { code } = options;

  // Create a function that page.evaluate() will serialize and send to browser
  // The function body uses indirect eval to execute user code in browser's
  // global scope
  const functionString = createBrowserEvalFunction(code);

  // Parse the function string into an actual function object
  // SECURITY NOTE: We still use Function() here, but this is acceptable because:
  // 1. The function will be immediately serialized by page.evaluate()
  // 2. The actual user code execution happens in browser, not here
  // 3. This function doesn't execute in Node.js - it's just a transport wrapper
  //
  // eslint-disable-next-line no-new-func
  const evaluateFunction = new Function(`return ${functionString}`)() as () => unknown;

  return {
    evaluateFunction,
    wasWrapped: true,
    originalCode: code,
  };
}

/**
 * Create a function string that executes user code via indirect eval
 * in the browser's global scope.
 *
 * When page.evaluate() calls .toString() on the returned function and
 * sends it to the browser, the browser's V8 will parse and execute it.
 *
 * The indirect eval pattern `(0, eval)(code)` ensures execution in the
 * global scope (window in browser, not the function's local scope).
 */
function createBrowserEvalFunction(code: string): string {
  // Escape the code for embedding in a JavaScript string literal
  // Use JSON.stringify for robust escaping
  const escapedCode = JSON.stringify(code);

  // Return a function expression as a string
  // page.evaluate() will parse this in the browser
  return `(function() {
    "use strict";
    return (0, eval)(${escapedCode});
  })`;
}

/**
 * Validate code for obvious injection attempts.
 *
 * This is a defense-in-depth layer. Even if code passes this check,
 * it still executes in the browser's isolated context.
 *
 * @param code - User-provided code
 * @returns Validation result
 */
export function validateCodeSafety(code: string): { safe: boolean; reason?: string } {
  // Check for obvious Node.js API access attempts
  const dangerousPatterns = [
    /require\s*\(/,
    /process\s*\./,
    /process\s*\[/,
    /global\s*\./,
    /global\s*\[/,
    /child_process/,
    /fs\s*\./,
    /import\s*\(/,
    /__dirname/,
    /__filename/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return {
        safe: false,
        reason: `Code contains potentially dangerous pattern: ${pattern.source}`,
      };
    }
  }

  return { safe: true };
}
