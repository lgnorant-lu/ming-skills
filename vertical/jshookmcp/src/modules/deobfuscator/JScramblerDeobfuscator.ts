import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

/**
 * Confidence = transformations / CONFIDENCE_DIVISOR (capped at 1.0):
 * each applied transformation contributes one divisor-sized confidence
 * point, so a typical 5-transformation run scores 1.0.
 */
const CONFIDENCE_DIVISOR = 5;
/** Radix used when parseInt is invoked without an explicit radix argument. */
const DEFAULT_PARSE_INT_RADIX = 10;

export interface JScramberDeobfuscatorOptions {
  code: string;
  removeDeadCode?: boolean;
  restoreControlFlow?: boolean;
  decryptStrings?: boolean;
  simplifyExpressions?: boolean;
}

export interface JScramberDeobfuscatorResult {
  code: string;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
}

/** Statically evaluable value during decrypt-function evaluation. */
type EvalValue = string | number | boolean | null | EvalValue[];

export class JScramberDeobfuscator {
  async deobfuscate(options: JScramberDeobfuscatorOptions): Promise<JScramberDeobfuscatorResult> {
    const {
      code,
      removeDeadCode = true,
      restoreControlFlow = true,
      decryptStrings = true,
      simplifyExpressions = true,
    } = options;

    logger.info(' JScrambler...');

    const transformations: string[] = [];
    const warnings: string[] = [];
    let currentCode = code;

    try {
      const ast = parser.parse(currentCode, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      if (this.detectSelfDefending(ast)) {
        this.removeSelfDefending(ast);
        transformations.push('');
      }

      if (decryptStrings) {
        const decrypted = this.decryptStrings(ast, warnings);
        if (decrypted > 0) {
          transformations.push(`: ${decrypted}`);
        }
      }

      if (restoreControlFlow) {
        const restored = this.restoreControlFlow(ast, warnings);
        if (restored > 0) {
          transformations.push(`: ${restored}`);
        }
      }

      if (removeDeadCode) {
        const removed = this.removeDeadCode(ast);
        if (removed > 0) {
          transformations.push(`: ${removed}`);
        }
      }

      if (simplifyExpressions) {
        const simplified = this.simplifyExpressions(ast);
        if (simplified > 0) {
          transformations.push(`: ${simplified}`);
        }
      }

      const output = generate(ast, {
        comments: true,
        compact: false,
      });

      currentCode = output.code;

      const confidence = this.calculateConfidence(transformations.length);

      logger.info(
        `JScrambler deobfuscation complete, ${transformations.length} transformations applied`,
      );

      return {
        code: currentCode,
        success: true,
        transformations,
        warnings,
        confidence,
      };
    } catch (error) {
      logger.error('JScrambler', error);
      return {
        code: currentCode,
        success: false,
        transformations,
        warnings: [...warnings, String(error)],
        confidence: 0,
      };
    }
  }

  private detectSelfDefending(ast: t.File): boolean {
    let hasSelfDefending = false;

    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
          hasSelfDefending = true;
        }

        const code = generate(path.node).code;
        if (code.includes('toString') && code.includes('constructor')) {
          hasSelfDefending = true;
        }
      },
    });

    return hasSelfDefending;
  }

  private removeSelfDefending(ast: t.File): void {
    traverse(ast, {
      DebuggerStatement(path) {
        path.remove();
      },

      CallExpression(path) {
        if (
          t.isIdentifier(path.node.callee) &&
          (path.node.callee.name === 'setInterval' || path.node.callee.name === 'setTimeout')
        ) {
          const arg = path.node.arguments[0];
          if (t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg)) {
            const body = arg.body;
            if (t.isBlockStatement(body)) {
              if (body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
                path.remove();
              }
            }
          }
        }
      },
    });
  }

  private decryptStrings(ast: t.File, warnings: string[]): number {
    let count = 0;

    const arrays = this.collectGlobalArrays(ast);
    const decryptFunctions = this.findDecryptFunctions(ast, arrays);
    if (decryptFunctions.size === 0) {
      return 0;
    }
    const defs = this.collectFunctionDefs(ast);

    traverse(ast, {
      CallExpression: (path) => {
        if (!t.isIdentifier(path.node.callee) || !decryptFunctions.has(path.node.callee.name)) {
          return;
        }
        const def = defs.get(path.node.callee.name);
        if (!def) {
          return;
        }
        const result = this.evaluateDecryptCall(def, path.node.arguments, arrays);
        if (result === undefined || result === null) {
          warnings.push(
            `Unable to statically decrypt ${path.node.callee.name}(...) call; left in place`,
          );
          return;
        }
        path.replaceWith(this.valueToNode(result));
        count++;
      },
    });

    return count;
  }

  /** Statically evaluable values inside a decrypt function. */
  private evaluateDecryptCall(
    fn: t.Function,
    args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
    arrays: Map<string, t.ArrayExpression>,
  ): string | number | boolean | null | undefined {
    const env = new Map<string, EvalValue>();

    const params = fn.params;
    for (let i = 0; i < params.length; i += 1) {
      const param = params[i];
      const arg = args[i];
      if (!param || !t.isIdentifier(param) || !arg || !t.isExpression(arg)) {
        return undefined;
      }
      const value = this.evalExpr(arg, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      env.set(param.name, value);
    }

    if (t.isBlockStatement(fn.body)) {
      return this.evalBlock(fn.body, env, arrays);
    }
    const bodyValue = this.evalExpr(fn.body, env, arrays);
    // A decrypt function whose final value is an array is not a string
    // decryptor — treat it as not statically decodable.
    return Array.isArray(bodyValue) ? undefined : bodyValue;
  }

  private evalBlock(
    body: t.BlockStatement,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): string | number | boolean | null | undefined {
    for (const stmt of body.body) {
      if (t.isVariableDeclaration(stmt)) {
        for (const decl of stmt.declarations) {
          if (!t.isIdentifier(decl.id) || !decl.init) {
            return undefined;
          }
          const value = this.evalExpr(decl.init, env, arrays);
          if (value === undefined) {
            return undefined;
          }
          env.set(decl.id.name, value);
        }
        continue;
      }
      if (
        t.isExpressionStatement(stmt) &&
        t.isAssignmentExpression(stmt.expression) &&
        t.isIdentifier(stmt.expression.left)
      ) {
        const value = this.evalExpr(stmt.expression.right, env, arrays);
        if (value === undefined) {
          return undefined;
        }
        env.set(stmt.expression.left.name, value);
        continue;
      }
      if (t.isReturnStatement(stmt)) {
        if (!stmt.argument) {
          return undefined;
        }
        const value = this.evalExpr(stmt.argument, env, arrays);
        return Array.isArray(value) ? undefined : value;
      }
      return undefined;
    }
    return undefined;
  }

  private evalExpr(
    node: t.Node,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue | undefined {
    if (t.isStringLiteral(node)) {
      return node.value;
    }
    if (t.isNumericLiteral(node)) {
      return node.value;
    }
    if (t.isBooleanLiteral(node)) {
      return node.value;
    }
    if (t.isNullLiteral(node)) {
      return null;
    }
    if (t.isIdentifier(node)) {
      if (env.has(node.name)) {
        return env.get(node.name);
      }
      const arr = arrays.get(node.name);
      return arr ? this.evalArray(arr, env, arrays) : undefined;
    }
    if (t.isMemberExpression(node)) {
      const obj = this.evalExpr(node.object, env, arrays);
      if (obj === undefined || obj === null) {
        return undefined;
      }
      if (!node.computed) {
        return undefined;
      }
      const prop = this.evalExpr(node.property, env, arrays);
      if (typeof obj === 'string' && typeof prop === 'number') {
        return obj.charAt(prop);
      }
      if (Array.isArray(obj) && typeof prop === 'number') {
        return (obj[prop] as string | number | boolean | null | undefined) ?? null;
      }
      return undefined;
    }
    if (t.isArrayExpression(node)) {
      return this.evalArray(node, env, arrays);
    }
    if (t.isBinaryExpression(node)) {
      const left = this.evalExpr(node.left, env, arrays);
      const right = this.evalExpr(node.right, env, arrays);
      if (
        left === undefined ||
        right === undefined ||
        Array.isArray(left) ||
        Array.isArray(right)
      ) {
        return undefined;
      }
      return this.evalBinary(node.operator, left, right);
    }
    if (t.isUnaryExpression(node)) {
      const value = this.evalExpr(node.argument, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      switch (node.operator) {
        case '!':
          return !value;
        case '-':
          return typeof value === 'number' ? -value : undefined;
        case '+':
          return typeof value === 'number' ? value : undefined;
        case '~':
          return typeof value === 'number' ? ~value : undefined;
        case 'typeof':
          return typeof value;
        default:
          return undefined;
      }
    }
    if (t.isLogicalExpression(node)) {
      const left = this.evalExpr(node.left, env, arrays);
      if (left === undefined) {
        return undefined;
      }
      if (node.operator === '&&') {
        return left ? this.evalExpr(node.right, env, arrays) : left;
      }
      if (node.operator === '||') {
        return left ? left : this.evalExpr(node.right, env, arrays);
      }
      // '??'
      return left !== null ? left : this.evalExpr(node.right, env, arrays);
    }
    if (t.isConditionalExpression(node)) {
      const test = this.evalExpr(node.test, env, arrays);
      if (test === undefined) {
        return undefined;
      }
      return this.evalExpr(test ? node.consequent : node.alternate, env, arrays);
    }
    if (t.isTemplateLiteral(node)) {
      let result = '';
      for (let i = 0; i < node.quasis.length; i += 1) {
        const q = node.quasis[i]!;
        result += q.value.cooked ?? q.value.raw;
        const expr = node.expressions[i];
        if (expr) {
          const value = this.evalExpr(expr, env, arrays);
          if (value === undefined || value === null) {
            return undefined;
          }
          result += String(value);
        }
      }
      return result;
    }
    if (t.isCallExpression(node)) {
      return this.evalCall(node, env, arrays);
    }
    return undefined;
  }

  private evalCall(
    node: t.CallExpression,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue | undefined {
    const evalArgs = (): Array<string | number | boolean | null> => {
      const values: Array<string | number | boolean | null> = [];
      for (const arg of node.arguments) {
        if (!t.isExpression(arg)) {
          return [];
        }
        const value = this.evalExpr(arg, env, arrays);
        if (value === undefined || value === null || Array.isArray(value)) {
          return [];
        }
        values.push(value);
      }
      return values;
    };

    const callee = node.callee;
    if (t.isIdentifier(callee)) {
      if (callee.name === 'String') {
        const values = evalArgs();
        return values.length === 1 ? String(values[0]) : undefined;
      }
      if (callee.name === 'Number') {
        const values = evalArgs();
        return values.length === 1 && typeof values[0] !== 'boolean'
          ? Number(values[0])
          : undefined;
      }
      if (callee.name === 'parseInt' || callee.name === 'parseFloat') {
        const values = evalArgs();
        if (values.length === 0) {
          return undefined;
        }
        return callee.name === 'parseInt'
          ? Number.parseInt(
              String(values[0]),
              typeof values[1] === 'number' ? values[1] : DEFAULT_PARSE_INT_RADIX,
            )
          : Number.parseFloat(String(values[0]));
      }
      return undefined;
    }

    if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
      const method = callee.property.name;
      // `String` itself is not an env/array value — resolve fromCharCode first.
      if (
        t.isIdentifier(callee.object) &&
        callee.object.name === 'String' &&
        method === 'fromCharCode'
      ) {
        const values = evalArgs();
        if (values.some((v) => typeof v !== 'number')) {
          return undefined;
        }
        return String.fromCharCode(...(values as number[]));
      }
      const obj = this.evalExpr(callee.object, env, arrays);
      if (obj === undefined || obj === null) {
        return undefined;
      }
      if (typeof obj === 'string') {
        const values = evalArgs();
        switch (method) {
          case 'charCodeAt': {
            const idx = values[0];
            if (typeof idx !== 'number') {
              return undefined;
            }
            return obj.charCodeAt(idx);
          }
          case 'charAt': {
            const idx = values[0];
            if (typeof idx !== 'number') {
              return undefined;
            }
            return obj.charAt(idx);
          }
          case 'split': {
            const sep = values[0];
            if (typeof sep !== 'string') {
              return undefined;
            }
            return obj.split(sep);
          }
          case 'substr':
          case 'substring':
          case 'slice': {
            const from = values[0];
            const to = values[1];
            if (typeof from !== 'number' || (to !== undefined && typeof to !== 'number')) {
              return undefined;
            }
            return method === 'substr'
              ? obj.substr(from, to as number | undefined)
              : method === 'substring'
                ? obj.substring(from, to as number | undefined)
                : obj.slice(from, to as number | undefined);
          }
          case 'concat': {
            if (values.some((v) => typeof v !== 'string')) {
              return undefined;
            }
            return obj.concat(...(values as string[]));
          }
          case 'indexOf': {
            const needle = values[0];
            if (typeof needle !== 'string') {
              return undefined;
            }
            return obj.indexOf(needle, typeof values[1] === 'number' ? values[1] : undefined);
          }
          case 'toLowerCase':
            return values.length === 0 ? obj.toLowerCase() : undefined;
          case 'toUpperCase':
            return values.length === 0 ? obj.toUpperCase() : undefined;
          case 'trim':
            return values.length === 0 ? obj.trim() : undefined;
          case 'replace': {
            if (
              values.length !== 2 ||
              typeof values[0] !== 'string' ||
              typeof values[1] !== 'string'
            ) {
              return undefined;
            }
            return obj.split(values[0]).join(values[1]);
          }
          default:
            return undefined;
        }
      }
    }
    return undefined;
  }

  private evalBinary(
    operator: t.BinaryExpression['operator'],
    left: string | number | boolean | null,
    right: string | number | boolean | null,
  ): string | number | boolean | undefined {
    switch (operator) {
      case '+':
        return typeof left === 'string' || typeof right === 'string'
          ? String(left) + String(right)
          : (left as number) + (right as number);
      case '-':
        return typeof left === 'number' && typeof right === 'number' ? left - right : undefined;
      case '*':
        return typeof left === 'number' && typeof right === 'number' ? left * right : undefined;
      case '/':
        return typeof left === 'number' && typeof right === 'number' ? left / right : undefined;
      case '%':
        return typeof left === 'number' && typeof right === 'number' ? left % right : undefined;
      case '**':
        return typeof left === 'number' && typeof right === 'number' ? left ** right : undefined;
      case '<<':
        return typeof left === 'number' && typeof right === 'number' ? left << right : undefined;
      case '>>':
        return typeof left === 'number' && typeof right === 'number' ? left >> right : undefined;
      case '>>>':
        return typeof left === 'number' && typeof right === 'number' ? left >>> right : undefined;
      case '&':
        return typeof left === 'number' && typeof right === 'number' ? left & right : undefined;
      case '|':
        return typeof left === 'number' && typeof right === 'number' ? left | right : undefined;
      case '^':
        return typeof left === 'number' && typeof right === 'number' ? left ^ right : undefined;
      case '<':
        return this.comparable(left) < this.comparable(right);
      case '>':
        return this.comparable(left) > this.comparable(right);
      case '<=':
        return this.comparable(left) <= this.comparable(right);
      case '>=':
        return this.comparable(left) >= this.comparable(right);
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      case '==':
        return left == right; // eslint-disable-line eqeqeq
      case '!=':
        return left != right; // eslint-disable-line eqeqeq
      default:
        return undefined;
    }
  }

  /** JS relational semantics for <, >, <=, >=: null → 0, booleans → 0/1. */
  private comparable(value: string | number | boolean | null): string | number {
    if (value === null || typeof value === 'boolean') {
      return Number(value);
    }
    return value;
  }

  private evalArray(
    node: t.ArrayExpression,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue[] | undefined {
    const values: EvalValue[] = [];
    for (const el of node.elements) {
      if (!el || t.isSpreadElement(el)) {
        return undefined;
      }
      const value = this.evalExpr(el, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  private valueToNode(value: string | number | boolean): t.Expression {
    if (typeof value === 'string') {
      return t.stringLiteral(value);
    }
    if (typeof value === 'number') {
      return t.numericLiteral(value);
    }
    return t.booleanLiteral(value);
  }

  /**
   * Invoke `onAssignment` for every VariableDeclarator that assigns a function
   * (function expression or arrow function) to an identifier — the
   * `isIdentifier + isFunction` guard previously duplicated in
   * {@link collectFunctionDefs} and {@link findDecryptFunctions}.
   */
  private forEachFunctionAssignment(
    decl: t.VariableDeclarator,
    onAssignment: (name: string, fn: t.Function) => void,
  ): void {
    const { id, init } = decl;
    if (t.isIdentifier(id) && (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))) {
      onAssignment(id.name, init);
    }
  }

  private collectFunctionDefs(ast: t.File): Map<string, t.Function> {
    const defs = new Map<string, t.Function>();
    // traverse() rebinds `this` in visitor callbacks — capture the helper.
    const forEachFunctionAssignment = this.forEachFunctionAssignment;
    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.id) {
          defs.set(path.node.id.name, path.node);
        }
      },
      VariableDeclarator(path) {
        forEachFunctionAssignment(path.node, (name, fn) => defs.set(name, fn));
      },
    });
    return defs;
  }

  private collectGlobalArrays(ast: t.File): Map<string, t.ArrayExpression> {
    const arrays = new Map<string, t.ArrayExpression>();
    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (t.isIdentifier(id) && t.isArrayExpression(init)) {
          arrays.set(id.name, init);
        }
      },
    });
    return arrays;
  }

  private findDecryptFunctions(ast: t.File, arrays: Map<string, t.ArrayExpression>): Set<string> {
    const decryptFunctions = new Set<string>();

    const register = (fn: t.Function, name: string | null): void => {
      if (name && this.looksLikeDecryptFunction(fn, arrays)) {
        decryptFunctions.add(name);
      }
    };

    // traverse() rebinds `this` in visitor callbacks — capture the helper.
    const forEachFunctionAssignment = this.forEachFunctionAssignment;
    traverse(ast, {
      FunctionDeclaration(path) {
        register(path.node, path.node.id?.name ?? null);
      },
      VariableDeclarator(path) {
        forEachFunctionAssignment(path.node, (name, fn) => register(fn, name));
      },
    });

    return decryptFunctions;
  }

  /** Heuristic: char-code based decoders, or functions indexing a string array. */
  private looksLikeDecryptFunction(
    fn: t.Function,
    arrays: Map<string, t.ArrayExpression>,
  ): boolean {
    const code = generate(fn).code;
    if (code.includes('fromCharCode') || code.includes('charCodeAt')) {
      return true;
    }

    // Array-index decryption: the body reads from a module-level string array
    // via computed access (`_str[i]`). Array names are source identifiers, so
    // escaping is unnecessary.
    for (const name of arrays.keys()) {
      if (new RegExp(`\\b${name}\\s*\\[`).test(code)) {
        return true;
      }
    }
    return false;
  }

  private restoreControlFlow(ast: t.File, warnings: string[]): number {
    let count = 0;
    traverse(ast, {
      WhileStatement: (path) => {
        if (this.isControlFlowFlatteningPattern(path.node)) {
          try {
            if (!this.unflattenControlFlowPattern(path)) {
              warnings.push(
                'Unable to linearize while-switch control-flow pattern (cyclic or unreachable states); left in place',
              );
            } else {
              count++;
            }
          } catch (error) {
            logger.warn('Failed to unflatten control-flow pattern', error);
          }
        }
      },
    });

    return count;
  }

  private isControlFlowFlatteningPattern(node: t.WhileStatement): boolean {
    if (!t.isBooleanLiteral(node.test) || !node.test.value) {
      return false;
    }

    if (!t.isBlockStatement(node.body)) {
      return false;
    }

    const firstStmt = node.body.body[0];
    return t.isSwitchStatement(firstStmt);
  }

  /**
   * Linearize a `while (true) { switch (state) { ... } }` state machine by
   * following the `state = <literal>` updates from the first case. Returns
   * false (leaving the pattern intact) when the state graph is cyclic, jumps
   * to an unknown target, or leaves cases unreachable — flattening those would
   * change program semantics.
   */
  private unflattenControlFlowPattern(path: NodePath<t.WhileStatement>): boolean {
    const whileStmt = path.node;
    if (!t.isBlockStatement(whileStmt.body)) {
      return false;
    }
    const switchStmt = whileStmt.body.body[0];
    if (!t.isSwitchStatement(switchStmt)) {
      return false;
    }

    // The switch discriminant must be a plain state variable.
    if (!t.isIdentifier(switchStmt.discriminant)) {
      return false;
    }
    const stateName = switchStmt.discriminant.name;
    const cases = switchStmt.cases;
    const first = cases[0];
    if (!first || first.test === null) {
      return false;
    }

    const sequence: t.SwitchCase[] = [];
    const visited = new Set<t.SwitchCase>();
    let current: t.SwitchCase | undefined = first;

    while (current) {
      if (visited.has(current)) {
        return false; // state cycle — cannot linearize
      }
      visited.add(current);
      sequence.push(current);

      let nextValue: string | number | null = null;
      for (const stmt of current.consequent) {
        const update = this.extractStateUpdate(stmt, stateName);
        if (update !== undefined) {
          nextValue = update;
        }
      }
      if (nextValue === null) {
        break; // terminal case
      }
      const nextCase = cases.find((c) => c.test !== null && this.caseTestValue(c) === nextValue);
      if (nextCase === undefined) {
        return false; // jump to an unknown state
      }
      current = nextCase;
    }

    if (visited.size !== cases.length) {
      return false; // unreachable cases — keep the pattern conservatively
    }

    const flattened = sequence.flatMap((c) =>
      c.consequent.filter(
        (stmt) =>
          this.extractStateUpdate(stmt, stateName) === undefined &&
          !t.isBreakStatement(stmt) &&
          !t.isContinueStatement(stmt),
      ),
    );

    if (flattened.length === 0) {
      return false;
    }

    path.replaceWithMultiple(flattened);
    return true;
  }

  /** Value of a `state = <literal>` statement, or undefined when not one. */
  private extractStateUpdate(stmt: t.Statement, stateName: string): string | number | undefined {
    if (
      !t.isExpressionStatement(stmt) ||
      !t.isAssignmentExpression(stmt.expression) ||
      !t.isIdentifier(stmt.expression.left) ||
      stmt.expression.left.name !== stateName
    ) {
      return undefined;
    }
    const right = stmt.expression.right;
    if (t.isNumericLiteral(right) || t.isStringLiteral(right)) {
      return right.value;
    }
    return undefined;
  }

  /** Case test as a primitive value, or null when not a literal. */
  private caseTestValue(c: t.SwitchCase): string | number | null {
    const test = c.test;
    if (t.isNumericLiteral(test) || t.isStringLiteral(test)) {
      return test.value;
    }
    return null;
  }

  private removeDeadCode(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      IfStatement(path) {
        if (t.isBooleanLiteral(path.node.test)) {
          if (path.node.test.value) {
            path.replaceWith(path.node.consequent);
          } else {
            if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
          }
          count++;
        }
      },
    });

    return count;
  }

  private simplifyExpressions(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      BinaryExpression(path) {
        if (t.isNumericLiteral(path.node.left) && t.isNumericLiteral(path.node.right)) {
          const left = path.node.left.value;
          const right = path.node.right.value;
          let result: number | undefined;

          switch (path.node.operator) {
            case '+':
              result = left + right;
              break;
            case '-':
              result = left - right;
              break;
            case '*':
              result = left * right;
              break;
            case '/':
              result = left / right;
              break;
          }

          if (result !== undefined) {
            path.replaceWith(t.numericLiteral(result));
            count++;
          }
        }
      },
    });

    return count;
  }

  private calculateConfidence(transformationCount: number): number {
    return Math.min(transformationCount / CONFIDENCE_DIVISOR, 1.0);
  }
}
