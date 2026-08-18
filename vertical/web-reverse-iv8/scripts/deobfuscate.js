#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const traverse = require('@babel/traverse').default;
const parser = require('@babel/parser');
const t = require('@babel/types');
const generator = require('@babel/generator').default;

function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-check') {
    runSelfCheck();
    return;
  }

  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  const config = loadConfig(args);

  validateConfig(config);

  const inputCode = fs.readFileSync(config.inputFile, 'utf8');
  const dependJsContent = fs.readFileSync(config.dependFile, 'utf8');
  let ast = parseJavaScript(inputCode);
  const startedAt = Date.now();
  const decryptReports = [];

  for (const decryptName of config.decryptNames) {
    const result = De_string_arraying_obfuscation(ast, decryptName, dependJsContent);
    ast = result.ast;
    decryptReports.push(result.report);
  }

  const outputCode = generator(ast).code;

  fs.mkdirSync(path.dirname(config.outputFile), { recursive: true });
  fs.writeFileSync(config.outputFile, outputCode, 'utf8');

  const finalReport = {
    inputFile: config.inputFile,
    outputFile: config.outputFile,
    dependFile: config.dependFile,
    decryptNames: config.decryptNames,
    module: 'string-array',
    decryptReports,
    durationMs: Date.now() - startedAt,
  };

  if (config.reportOut) {
    fs.mkdirSync(path.dirname(config.reportOut), { recursive: true });
    fs.writeFileSync(config.reportOut, JSON.stringify(finalReport, null, 2), 'utf8');
  }

  process.stdout.write(JSON.stringify(finalReport, null, 2) + '\n');
}

function printHelp() {
  const help = [
    'Usage: node scripts/deobfuscate.js --input <file> --output <file> --depend <file> --decrypt <name> [--report-out <file>]',
    '       node scripts/deobfuscate.js --self-check',
    '       node scripts/deobfuscate.js --help | -h',
    '',
    'String array deobfuscation via AST (babel). Strictly restores string array calls only.',
    'No variable rename / CFF recovery / dead code elimination / helper inlining.',
    '',
    'Required:',
    '  --input <file>       Path to obfuscated JS file.',
    '  --output <file>      Path to write deobfuscated JS.',
    '  --depend <file>      Path to depend.js (decrypt runtime). See assets/samples/depend-js-guide.md.',
    '  --decrypt <name>     Decrypt function name (comma-separated for multiple).',
    '',
    'Optional:',
    '  --report-out <file>  Path to write report.json (failure detection signal).',
    '',
    'Modes:',
    '  --self-check         Run 56 built-in test cases and exit.',
    '  --help, -h           Show this help and exit.',
    '',
    'Exit codes:',
    '  0  success (or help/self-check pass)',
    '  1  runtime error (missing args, file not found, eval throw, etc.)',
  ].join('\n');
  process.stdout.write(help + '\n');
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function loadConfig(args) {
  const report = args.report ? readJson(args.report) : {};

  return {
    inputFile: resolveMaybe(args.input || report['输入文件']),
    outputFile: resolveMaybe(args.output || report['输出文件']),
    dependFile: resolveMaybe(args.depend || report['依赖文件']),
    reportOut: resolveMaybe(args['report-out']),
    decryptNames: normalizeList(args.decrypt || args.decryptNames || report['解密函数']),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveMaybe(filePath) {
  if (!filePath) return undefined;
  return path.resolve(filePath);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function validateConfig(config) {
  assertReadableFile(config.inputFile, 'input file');
  assertReadableFile(config.dependFile, 'dependency file');

  if (!config.outputFile) {
    throw new Error('Missing output file. Use --output or provide 输出文件 in --report JSON.');
  }

  if (!Array.isArray(config.decryptNames) || config.decryptNames.length === 0) {
    throw new Error('Missing decrypt function. Use --decrypt or provide 解密函数 in --report JSON.');
  }
}

function assertReadableFile(filePath, label) {
  if (!filePath) {
    throw new Error(`Missing ${label}.`);
  }

  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    throw new Error(`Cannot read ${label}: ${filePath}`);
  }
}

function parseJavaScript(code) {
  return parser.parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
  });
}

function De_string_arraying_obfuscation(ast, DECNAME, dependJsContent) {
  /**
   * 大数组还原与解密函数处理主流程
   * 功能：
   * 1. 还原对象字面量形式的数值映射表
   * 2. 识别目标解密函数调用和常量别名调用
   * 3. 用 dependJsContent 执行解密函数并替换静态参数调用
   * 4. 依赖脚本是大数组以及数组偏移的代码
   * DECNAME:是大数组本体，以及数组偏移代码
   */

  const decryptTargets = collectDecryptTargets(ast, DECNAME);
  const numericObjectMaps = collectNumericObjectMaps(ast, decryptTargets);
  const decryptReport = {
    decryptName: DECNAME,
    aliases: [],
    wrappers: [],
    targetCalls: 0,
    replacedCalls: 0,
    staticArgumentFailures: 0,
    evalFailures: 0,
    unsupportedResultFailures: 0,
  };
  normalizeDecryptCallArguments(ast, decryptTargets, numericObjectMaps);

  function collectNumericObjectMaps(ast, decryptTargets) {
    const mapsByIdentity = new Map();
    const scopeIds = new WeakMap();
    let nextScopeId = 0;
    const targetObjectIdentities = collectTargetObjectIdentities();
    if (targetObjectIdentities.size === 0) {
      return {
        getByName() {
          return [];
        }
      };
    }

    traverse(ast, {
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        if (!targetObjectIdentities.has(getIdentity(path.scope, path.node.id.name))) return;

        const initPath = path.get('init');
        if (!initPath.node || !initPath.isObjectExpression() || initPath.node.properties.length === 0) return;

        const values = collectObjectLiteralValues(initPath);
        if (!values) return;

        const statementPath = path.getStatementParent();
        const data = {
          kind: 'literal',
          aliases: new Set([getIdentity(path.scope, path.node.id.name)]),
          values,
          validTo: null,
          buildPaths: [path],
        };
        data.validTo = minPosition(
          findValidToInSameVariableDeclaration(path, data),
          findValidToFromBody(statementPath, data)
        );
        for (const alias of data.aliases) {
          addMapForIdentity(alias, data);
        }
        for (const entry of values.values()) {
          entry.validFrom = path.node.end ?? statementPath?.node?.end ?? 0;
        }
      },
      AssignmentExpression(path) {
        if (path.node.operator !== '=' || !t.isIdentifier(path.node.left)) return;
        if (!targetObjectIdentities.has(getIdentity(path.scope, path.node.left.name))) return;

        const rightPath = path.get('right');
        if (!rightPath.isObjectExpression() || rightPath.node.properties.length === 0) return;

        const values = collectObjectLiteralValues(rightPath);
        if (!values) return;

        const statementPath = path.getStatementParent();
        const data = {
          kind: 'literal',
          aliases: new Set([getIdentity(path.scope, path.node.left.name)]),
          values,
          validTo: null,
          buildPaths: [path],
        };
        data.validTo = findValidToFromBody(statementPath, data);
        for (const alias of data.aliases) {
          addMapForIdentity(alias, data);
        }
        for (const entry of values.values()) {
          entry.validFrom = statementPath?.node?.end ?? path.node.end ?? 0;
        }
      },
      Program(path) {
        collectIncrementalMapsFromBody(path.get('body'));
      },
      BlockStatement(path) {
        collectIncrementalMapsFromBody(path.get('body'));
      }
    });

    return {
      getByName(scope, name) {
        return mapsByIdentity.get(getIdentity(scope, name)) || [];
      }
    };

    function collectObjectLiteralValues(objectPath) {
      const values = new Map();

      for (const propPath of objectPath.get('properties')) {
        if (!propPath.isObjectProperty()) return null;

        const key = getStaticObjectPropertyKey(propPath.node);
        if (key === null) return null;

        const numberValue = getStaticNumber(propPath.get('value'));
        if (numberValue === null) return null;

        values.set(key, {
          value: numberValue,
          validFrom: 0,
        });
      }

      return values.size > 0 ? values : null;
    }

    function collectIncrementalMapsFromBody(bodyPaths) {
      for (let index = 0; index < bodyPaths.length; index += 1) {
        const inits = getEmptyObjectInitsFromStatement(bodyPaths[index]);
        if (inits.length === 0) continue;

        for (const init of inits) {
          const data = scanIncrementalObjectMap(bodyPaths, index, init);
          if (!data || data.values.size === 0) continue;

          data.validTo = findValidToFromBody(init.statementPath, data);
          for (const alias of data.aliases) {
            addMapForIdentity(alias, data);
          }
        }
      }
    }

    function getEmptyObjectInitsFromStatement(statementPath) {
      const inits = [];

      if (statementPath.isVariableDeclaration()) {
        const declarations = statementPath.get('declarations');
        for (let index = 0; index < declarations.length; index += 1) {
          const declarator = declarations[index];
          if (
            t.isIdentifier(declarator.node.id) &&
            targetObjectIdentities.has(getIdentity(declarator.scope, declarator.node.id.name)) &&
            declarator.get('init').isObjectExpression() &&
            declarator.node.init.properties.length === 0
          ) {
            inits.push({
              name: declarator.node.id.name,
              scope: declarator.scope,
              statementPath,
              declaratorIndex: index,
              path: declarator,
            });
          }
        }
      }

      if (statementPath.isExpressionStatement()) {
        const expressionPath = statementPath.get('expression');
        if (
          expressionPath.isAssignmentExpression({ operator: '=' }) &&
          t.isIdentifier(expressionPath.node.left) &&
          targetObjectIdentities.has(getIdentity(expressionPath.scope, expressionPath.node.left.name)) &&
          expressionPath.get('right').isObjectExpression() &&
          expressionPath.node.right.properties.length === 0
        ) {
          inits.push({
            name: expressionPath.node.left.name,
            scope: expressionPath.scope,
            statementPath,
            declaratorIndex: null,
            path: expressionPath,
          });
        }
      }

      return inits;
    }

    function scanIncrementalObjectMap(bodyPaths, initIndex, init) {
      const data = {
        kind: 'incremental',
        aliases: new Set([getIdentity(init.scope, init.name)]),
        values: new Map(),
        validTo: null,
        buildPaths: [init.path],
      };

      if (init.declaratorIndex !== null) {
        const declarations = init.statementPath.get('declarations');
        for (let i = init.declaratorIndex + 1; i < declarations.length; i += 1) {
          const result = scanDeclarator(declarations[i], data);
          if (result === 'stop') {
            data.validTo = init.statementPath.node.end ?? null;
            return data;
          }
        }
      }

      for (let index = initIndex + 1; index < bodyPaths.length; index += 1) {
        const statementPath = bodyPaths[index];
        const result = scanStatement(statementPath, data);
        if (result === 'stop') {
          data.validTo = statementPath.node.end ?? null;
          break;
        }
      }

      return data;
    }

    function scanStatement(statementPath, data) {
      if (statementPath.isEmptyStatement()) return 'continue';

      if (statementPath.isVariableDeclaration()) {
        const declarations = statementPath.get('declarations');
        for (const declarator of declarations) {
          const result = scanDeclarator(declarator, data);
          if (result === 'stop') return 'stop';
        }
        return 'continue';
      }

      if (statementPath.isExpressionStatement()) {
        const expressionPath = statementPath.get('expression');
        if (expressionPath.isAssignmentExpression({ operator: '=' })) {
          return scanAssignment(expressionPath, data);
        }
        return expressionTouchesTargetOrHasSideEffect(expressionPath, data) ? 'stop' : 'continue';
      }

      return 'stop';
    }

    function scanDeclarator(declaratorPath, data) {
      const initPath = declaratorPath.get('init');
      if (!initPath.node) return 'continue';

      if (t.isIdentifier(declaratorPath.node.id) && isTargetIdentifier(initPath, data)) {
        data.aliases.add(getIdentity(declaratorPath.scope, declaratorPath.node.id.name));
        data.buildPaths.push(declaratorPath);
        return 'continue';
      }

      if (expressionReadsTarget(initPath, data)) return 'stop';
      if (!isPureSkippableExpression(initPath)) return 'stop';
      return 'continue';
    }

    function scanAssignment(assignmentPath, data) {
      const leftPath = assignmentPath.get('left');
      const rightPath = assignmentPath.get('right');

      if (leftPath.isIdentifier()) {
        if (isTargetIdentifier(leftPath, data)) return 'stop';
        if (isTargetIdentifier(rightPath, data)) {
          data.aliases.add(getIdentity(leftPath.scope, leftPath.node.name));
          data.buildPaths.push(assignmentPath);
          return 'continue';
        }
        return expressionReadsTarget(rightPath, data) || !isPureSkippableExpression(rightPath) ? 'stop' : 'continue';
      }

      if (!leftPath.isMemberExpression()) {
        return expressionTouchesTargetOrHasSideEffect(assignmentPath, data) ? 'stop' : 'continue';
      }

      const objectPath = leftPath.get('object');
      if (!objectPath.isIdentifier() || !data.aliases.has(getIdentity(objectPath.scope, objectPath.node.name))) {
        return expressionTouchesTargetOrHasSideEffect(assignmentPath, data) ? 'stop' : 'continue';
      }

      const key = getStaticMemberExpressionKey(leftPath.node);
      if (key === null) return 'stop';

      const numberValue = getStaticNumber(rightPath);
      if (numberValue === null) return 'stop';

      data.values.set(key, {
        value: numberValue,
        validFrom: assignmentPath.getStatementParent()?.node?.end ?? assignmentPath.node.end ?? 0,
      });
      data.buildPaths.push(assignmentPath);
      return 'continue';
    }

    function expressionTouchesTargetOrHasSideEffect(expressionPath, data) {
      return expressionReadsTarget(expressionPath, data) || expressionHasSideEffect(expressionPath);
    }

    function expressionReadsTarget(expressionPath, data) {
      let found = false;
      expressionPath.traverse({
        Identifier(path) {
          if (data.aliases.has(getIdentity(path.scope, path.node.name))) {
            found = true;
            path.stop();
          }
        }
      });
      return found;
    }

    function expressionHasSideEffect(expressionPath) {
      let found = false;
      expressionPath.traverse({
        CallExpression(path) {
          found = true;
          path.stop();
        },
        NewExpression(path) {
          found = true;
          path.stop();
        },
        AssignmentExpression(path) {
          found = true;
          path.stop();
        },
        UpdateExpression(path) {
          found = true;
          path.stop();
        },
        AwaitExpression(path) {
          found = true;
          path.stop();
        },
        YieldExpression(path) {
          found = true;
          path.stop();
        }
      });
      return found;
    }

    function isPureSkippableExpression(expressionPath) {
      if (expressionHasSideEffect(expressionPath)) return false;

      let hasUnsafeMember = false;
      expressionPath.traverse({
        MemberExpression(path) {
          if (!isStaticLiteralLength(path.node)) {
            hasUnsafeMember = true;
            path.stop();
          }
        }
      });
      return !hasUnsafeMember;
    }

    function findValidToInSameVariableDeclaration(declaratorPath, data) {
      const parentPath = declaratorPath.parentPath;
      if (!parentPath || !parentPath.isVariableDeclaration()) return null;

      const declarations = parentPath.get('declarations');
      const startIndex = declarations.findIndex(path => path.node === declaratorPath.node);
      if (startIndex < 0) return null;

      for (let index = startIndex + 1; index < declarations.length; index += 1) {
        const declarator = declarations[index];
        if (t.isIdentifier(declarator.node.id) && data.aliases.has(getIdentity(declarator.scope, declarator.node.id.name))) {
          return declarator.node.start ?? null;
        }

        const initPath = declarator.get('init');
        if (!initPath.node) continue;

        if (t.isIdentifier(declarator.node.id) && isTargetIdentifier(initPath, data)) {
          data.aliases.add(getIdentity(declarator.scope, declarator.node.id.name));
          data.buildPaths.push(declarator);
          continue;
        }

        if (expressionInvalidatesObjectMap(initPath, data)) {
          return declarator.node.start ?? null;
        }
      }

      return null;
    }

    function isStaticLiteralLength(node) {
      return (
        t.isMemberExpression(node) &&
        !node.computed &&
        t.isIdentifier(node.property, { name: 'length' }) &&
        (t.isStringLiteral(node.object) || t.isArrayExpression(node.object))
      );
    }

    function findValidToFromBody(startStatementPath, data) {
      const parentPath = startStatementPath.parentPath;
      if (!parentPath || (!parentPath.isProgram() && !parentPath.isBlockStatement())) return null;

      const bodyPaths = parentPath.get('body');
      const startIndex = bodyPaths.findIndex(path => path.node === startStatementPath.node);
      if (startIndex < 0) return null;

      for (let index = startIndex + 1; index < bodyPaths.length; index += 1) {
        const statementPath = bodyPaths[index];
        if (isBuildStatement(statementPath, data)) continue;
        if (statementInvalidatesObjectMap(statementPath, data)) {
          return statementPath.node.end ?? null;
        }
      }

      return null;
    }

    function isBuildStatement(statementPath, data) {
      return data.buildPaths.some(buildPath => buildPath.getStatementParent()?.node === statementPath.node);
    }

    function statementInvalidatesObjectMap(statementPath, data) {
      if (statementPath.isEmptyStatement() || statementPath.isFunctionDeclaration() || statementPath.isClassDeclaration()) {
        return false;
      }

      if (statementPath.isReturnStatement()) {
        const argumentPath = statementPath.get('argument');
        return argumentPath.node ? expressionInvalidatesObjectMap(argumentPath, data) : false;
      }

      if (!statementPath.isExpressionStatement() && !statementPath.isVariableDeclaration()) {
        return true;
      }

      if (statementPath.isExpressionStatement()) {
        const expressionPath = statementPath.get('expression');
        if (expressionPath.isAssignmentExpression({ operator: '=' })) {
          const leftPath = expressionPath.get('left');
          const rightPath = expressionPath.get('right');
          if (leftPath.isIdentifier() && isTargetIdentifier(rightPath, data)) {
            data.aliases.add(getIdentity(leftPath.scope, leftPath.node.name));
            data.buildPaths.push(expressionPath);
            return false;
          }
        }
        return expressionInvalidatesObjectMap(expressionPath, data);
      }

      for (const declarator of statementPath.get('declarations')) {
        if (t.isIdentifier(declarator.node.id) && data.aliases.has(getIdentity(declarator.scope, declarator.node.id.name))) {
          return true;
        }

        const initPath = declarator.get('init');
        if (initPath.node && t.isIdentifier(declarator.node.id) && isTargetIdentifier(initPath, data)) {
          data.aliases.add(getIdentity(declarator.scope, declarator.node.id.name));
          data.buildPaths.push(declarator);
          continue;
        }

        if (initPath.node && expressionInvalidatesObjectMap(initPath, data)) {
          return true;
        }
      }

      return false;
    }

    function expressionInvalidatesObjectMap(expressionPath, data) {
      if (!expressionPath.node) return false;

      if (expressionPath.isAssignmentExpression()) {
        if (assignmentInvalidatesObjectMap(expressionPath, data)) return true;
      }

      if (expressionPath.isUpdateExpression()) {
        if (updateInvalidatesObjectMap(expressionPath, data)) return true;
      }

      if (expressionPath.isUnaryExpression({ operator: 'delete' })) {
        if (deleteInvalidatesObjectMap(expressionPath, data)) return true;
      }

      if (expressionPath.isCallExpression()) {
        if (callInvalidatesObjectMap(expressionPath, data)) return true;
      }

      if (expressionPath.isNewExpression()) {
        if (newInvalidatesObjectMap(expressionPath, data)) return true;
      }

      let invalidates = false;
      expressionPath.traverse({
        AssignmentExpression(path) {
          if (assignmentInvalidatesObjectMap(path, data)) {
            invalidates = true;
            path.stop();
          }
        },
        UpdateExpression(path) {
          if (updateInvalidatesObjectMap(path, data)) {
            invalidates = true;
            path.stop();
          }
        },
        UnaryExpression(path) {
          if (deleteInvalidatesObjectMap(path, data)) {
            invalidates = true;
            path.stop();
          }
        },
        CallExpression(path) {
          if (callInvalidatesObjectMap(path, data)) {
            invalidates = true;
            path.stop();
          }
        },
        NewExpression(path) {
          if (newInvalidatesObjectMap(path, data)) {
            invalidates = true;
            path.stop();
          }
        },
        WithStatement(path) {
          invalidates = true;
          path.stop();
        }
      });

      return invalidates;
    }

    function assignmentInvalidatesObjectMap(path, data) {
      const leftPath = path.get('left');
      if (leftPath.isIdentifier() && isTargetIdentifier(leftPath, data)) return true;

      if (leftPath.isMemberExpression()) {
        const objectPath = leftPath.get('object');
        return objectPath.isIdentifier() && isTargetIdentifier(objectPath, data);
      }

      return false;
    }

    function updateInvalidatesObjectMap(path, data) {
      const argumentPath = path.get('argument');
      if (argumentPath.isIdentifier() && isTargetIdentifier(argumentPath, data)) return true;

      if (argumentPath.isMemberExpression()) {
        const objectPath = argumentPath.get('object');
        return objectPath.isIdentifier() && isTargetIdentifier(objectPath, data);
      }

      return false;
    }

    function deleteInvalidatesObjectMap(path, data) {
      if (!path.isUnaryExpression({ operator: 'delete' })) return false;

      const argumentPath = path.get('argument');
      if (argumentPath.isIdentifier() && isTargetIdentifier(argumentPath, data)) return true;

      if (argumentPath.isMemberExpression()) {
        const objectPath = argumentPath.get('object');
        return objectPath.isIdentifier() && isTargetIdentifier(objectPath, data);
      }

      return false;
    }

    function callInvalidatesObjectMap(path, data) {
      return isEvalCall(path) || path.get('arguments').some(arg => arg.isIdentifier() && isTargetIdentifier(arg, data));
    }

    function newInvalidatesObjectMap(path, data) {
      return path.get('arguments').some(arg => arg.isIdentifier() && isTargetIdentifier(arg, data));
    }

    function isEvalCall(path) {
      return path.get('callee').isIdentifier({ name: 'eval' });
    }

    function addMapForName(scope, name, data) {
      addMapForIdentity(getIdentity(scope, name), data);
    }

    function addMapForIdentity(identity, data) {
      const maps = mapsByIdentity.get(identity) || [];
      if (!maps.includes(data)) maps.push(data);
      mapsByIdentity.set(identity, maps);
    }

    function getIdentity(scope, name) {
      const binding = scope.getBinding(name);
      if (binding) return binding;
      if (!scopeIds.has(scope)) {
        scopeIds.set(scope, nextScopeId);
        nextScopeId += 1;
      }
      return `${scopeIds.get(scope)}:${name}`;
    }

    function minPosition(left, right) {
      if (left === null) return right;
      if (right === null) return left;
      return Math.min(left, right);
    }

    function isTargetIdentifier(path, data) {
      return path.isIdentifier() && data.aliases.has(getIdentity(path.scope, path.node.name));
    }

    function collectTargetObjectIdentities() {
      const identities = new Set();
      const aliasPairs = [];

      traverse(ast, {
        CallExpression(path) {
          if (!decryptTargets.isTargetCall(path)) return;

          for (const argumentPath of path.get('arguments')) {
            collectMemberObjectIdentities(argumentPath, identities);
          }
        },
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const initPath = path.get('init');
          if (!initPath.isIdentifier()) return;
          aliasPairs.push([
            getIdentity(path.scope, path.node.id.name),
            getIdentity(initPath.scope, initPath.node.name),
          ]);
        },
        AssignmentExpression(path) {
          if (path.node.operator !== '=' || !t.isIdentifier(path.node.left)) return;
          const rightPath = path.get('right');
          if (!rightPath.isIdentifier()) return;
          aliasPairs.push([
            getIdentity(path.scope, path.node.left.name),
            getIdentity(rightPath.scope, rightPath.node.name),
          ]);
        }
      });

      let changed = true;
      while (changed) {
        changed = false;
        for (const [leftIdentity, rightIdentity] of aliasPairs) {
          if (identities.has(leftIdentity) && !identities.has(rightIdentity)) {
            identities.add(rightIdentity);
            changed = true;
          }
          if (identities.has(rightIdentity) && !identities.has(leftIdentity)) {
            identities.add(leftIdentity);
            changed = true;
          }
        }
      }

      return identities;
    }

    function collectMemberObjectIdentities(argumentPath, identities) {
      if (argumentPath.isMemberExpression()) {
        addMemberObjectIdentity(argumentPath, identities);
      }

      argumentPath.traverse({
        MemberExpression(path) {
          addMemberObjectIdentity(path, identities);
        }
      });
    }

    function addMemberObjectIdentity(memberPath, identities) {
      const objectPath = memberPath.get('object');
      if (!objectPath.isIdentifier()) return;
      if (getStaticMemberExpressionKey(memberPath.node) === null) return;
      identities.add(getIdentity(objectPath.scope, objectPath.node.name));
    }
  }

  function normalizeDecryptCallArguments(ast, decryptTargets, numericObjectMaps) {
    traverse(ast, {
      CallExpression(path) {
        if (!decryptTargets.isTargetCall(path)) return;

        for (const argumentPath of path.get('arguments')) {
          normalizeArgumentPath(argumentPath, numericObjectMaps);
        }
      }
    });
  }

  function normalizeArgumentPath(argumentPath, numericObjectMaps) {
    if (argumentPath.isMemberExpression()) {
      normalizeMemberExpressionPath(argumentPath, numericObjectMaps);
      return;
    }

    argumentPath.traverse({
      MemberExpression(path) {
        normalizeMemberExpressionPath(path, numericObjectMaps);
      }
    });
  }

  function normalizeMemberExpressionPath(memberPath, numericObjectMaps) {
    if (!memberPath.isMemberExpression()) return;

    const objectPath = memberPath.get('object');
    if (!objectPath.isIdentifier()) return;

    const key = getStaticMemberExpressionKey(memberPath.node);
    if (key === null) return;

    const position = memberPath.node.start ?? 0;
    const objectMaps = numericObjectMaps.getByName(objectPath.scope, objectPath.node.name);
    for (let index = objectMaps.length - 1; index >= 0; index -= 1) {
      const objectMap = objectMaps[index];
      const entry = objectMap.values.get(key);
      if (!entry) continue;

      if (position < entry.validFrom) continue;
      if (objectMap.validTo !== null && position > objectMap.validTo) continue;

      memberPath.replaceWith(t.numericLiteral(entry.value));
      return;
    }
  }

  function getStaticObjectPropertyKey(node) {
    if (!t.isObjectProperty(node) || node.computed) return null;
    if (t.isIdentifier(node.key)) return node.key.name;
    if (t.isStringLiteral(node.key)) return node.key.value;
    return null;
  }

  function getStaticMemberExpressionKey(node) {
    if (!t.isMemberExpression(node)) return null;
    if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
    if (node.computed && t.isStringLiteral(node.property)) return node.property.value;
    return null;
  }

function getStaticNumber(valuePath) {
  const evaluated = getStaticValue(valuePath);
  if (evaluated.success && typeof evaluated.value === 'number' && Number.isFinite(evaluated.value)) {
    return evaluated.value;
  }
  return null;
}

function getStaticValue(valuePath) {
  const evaluated = valuePath.evaluate();
  if (evaluated.confident && isSupportedStaticValue(evaluated.value)) {
    return {
      success: true,
      value: evaluated.value,
    };
  }

  const fallback = evaluateStaticNode(valuePath.node);
  if (fallback.success && isSupportedStaticValue(fallback.value)) {
    return fallback;
  }

  return {
    success: false,
    error: new Error(`value is not safely static: ${valuePath.toString()}`),
  };
}

function evaluateStaticNode(node) {
  if (t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBooleanLiteral(node)) {
    return { success: true, value: node.value };
  }

  if (t.isNullLiteral(node)) {
    return { success: true, value: null };
  }

  if (t.isIdentifier(node)) {
    if (node.name === 'undefined') return { success: true, value: undefined };
    if (node.name === 'NaN') return { success: true, value: NaN };
    if (node.name === 'Infinity') return { success: true, value: Infinity };
    return { success: false };
  }

  if (t.isUnaryExpression(node)) {
    const argument = evaluateStaticNode(node.argument);
    if (!argument.success) return { success: false };
    switch (node.operator) {
      case '+':
        return { success: true, value: +argument.value };
      case '-':
        return { success: true, value: -argument.value };
      case '!':
        return { success: true, value: !argument.value };
      case '~':
        return { success: true, value: ~argument.value };
      case 'void':
        return { success: true, value: undefined };
      default:
        return { success: false };
    }
  }

  if (t.isBinaryExpression(node)) {
    const left = evaluateStaticNode(node.left);
    const right = evaluateStaticNode(node.right);
    if (!left.success || !right.success) return { success: false };
    return evaluateStaticBinaryExpression(node.operator, left.value, right.value);
  }

  if (t.isLogicalExpression(node)) {
    const left = evaluateStaticNode(node.left);
    if (!left.success) return { success: false };
    if (node.operator === '&&') return left.value ? evaluateStaticNode(node.right) : left;
    if (node.operator === '||') return left.value ? left : evaluateStaticNode(node.right);
    if (node.operator === '??') return left.value === null || left.value === undefined ? evaluateStaticNode(node.right) : left;
    return { success: false };
  }

  if (t.isConditionalExpression(node)) {
    const test = evaluateStaticNode(node.test);
    if (!test.success) return { success: false };
    return evaluateStaticNode(test.value ? node.consequent : node.alternate);
  }

  if (t.isSequenceExpression(node)) {
    if (node.expressions.length === 0) return { success: false };
    return evaluateStaticNode(node.expressions[node.expressions.length - 1]);
  }

  if (t.isTemplateLiteral(node)) {
    let value = '';
    for (let index = 0; index < node.quasis.length; index += 1) {
      value += node.quasis[index].value.cooked;
      if (index < node.expressions.length) {
        const expression = evaluateStaticNode(node.expressions[index]);
        if (!expression.success) return { success: false };
        value += String(expression.value);
      }
    }
    return { success: true, value };
  }

  if (t.isArrayExpression(node)) {
    const values = [];
    for (const element of node.elements) {
      if (!element) return { success: false };
      const value = evaluateStaticNode(element);
      if (!value.success) return { success: false };
      values.push(value.value);
    }
    return { success: true, value: values };
  }

  if (t.isMemberExpression(node)) {
    return evaluateStaticMemberExpression(node);
  }

  if (t.isCallExpression(node)) {
    return evaluateStaticCallExpression(node);
  }

  return { success: false };
}

function evaluateStaticBinaryExpression(operator, left, right) {
  switch (operator) {
    case '+':
      return { success: true, value: left + right };
    case '-':
      return { success: true, value: left - right };
    case '*':
      return { success: true, value: left * right };
    case '/':
      return { success: true, value: left / right };
    case '%':
      return { success: true, value: left % right };
    case '**':
      return { success: true, value: left ** right };
    case '|':
      return { success: true, value: left | right };
    case '&':
      return { success: true, value: left & right };
    case '^':
      return { success: true, value: left ^ right };
    case '<<':
      return { success: true, value: left << right };
    case '>>':
      return { success: true, value: left >> right };
    case '>>>':
      return { success: true, value: left >>> right };
    case '==':
      return { success: true, value: left == right };
    case '!=':
      return { success: true, value: left != right };
    case '===':
      return { success: true, value: left === right };
    case '!==':
      return { success: true, value: left !== right };
    case '<':
      return { success: true, value: left < right };
    case '<=':
      return { success: true, value: left <= right };
    case '>':
      return { success: true, value: left > right };
    case '>=':
      return { success: true, value: left >= right };
    default:
      return { success: false };
  }
}

function evaluateStaticMemberExpression(node) {
  if (!node.computed && t.isIdentifier(node.object, { name: 'Number' }) && t.isIdentifier(node.property)) {
    const numberConstants = {
      MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      MAX_VALUE: Number.MAX_VALUE,
      MIN_VALUE: Number.MIN_VALUE,
      EPSILON: Number.EPSILON,
      POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
      NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
      NaN: Number.NaN,
    };
    if (Object.prototype.hasOwnProperty.call(numberConstants, node.property.name)) {
      return { success: true, value: numberConstants[node.property.name] };
    }
  }

  const object = evaluateStaticNode(node.object);
  if (!object.success) return { success: false };

  const key = getStaticPropertyAccessKey(node);
  if (!key.success) return { success: false };

  if (key.value === 'length' && (typeof object.value === 'string' || Array.isArray(object.value))) {
    return { success: true, value: object.value.length };
  }

  if (Array.isArray(object.value) && Number.isInteger(key.value)) {
    return { success: true, value: object.value[key.value] };
  }

  return { success: false };
}

function evaluateStaticCallExpression(node) {
  const args = [];
  for (const argument of node.arguments) {
    if (t.isSpreadElement(argument)) return { success: false };
    const value = evaluateStaticNode(argument);
    if (!value.success) return { success: false };
    args.push(value.value);
  }

  if (t.isMemberExpression(node.callee)) {
    const callee = node.callee;
    const method = getStaticPropertyAccessKey(callee);
    if (!method.success || typeof method.value !== 'string') return { success: false };

    if (t.isIdentifier(callee.object, { name: 'String' }) && method.value === 'fromCharCode') {
      if (!args.every(Number.isFinite)) return { success: false };
      return { success: true, value: String.fromCharCode(...args) };
    }

    const object = evaluateStaticNode(callee.object);
    if (!object.success) return { success: false };

    if (typeof object.value === 'string') {
      if (method.value === 'charCodeAt') return { success: true, value: object.value.charCodeAt(args[0] ?? 0) };
      if (method.value === 'codePointAt') return { success: true, value: object.value.codePointAt(args[0] ?? 0) };
      if (method.value === 'charAt') return { success: true, value: object.value.charAt(args[0] ?? 0) };
    }
  }

  if (t.isIdentifier(node.callee)) {
    if (node.callee.name === 'Number' && args.length === 1) return { success: true, value: Number(args[0]) };
    if (node.callee.name === 'String' && args.length === 1) return { success: true, value: String(args[0]) };
    if (node.callee.name === 'parseInt' && (args.length === 1 || args.length === 2)) return { success: true, value: parseInt(args[0], args[1]) };
  }

  return { success: false };
}

function getStaticPropertyAccessKey(node) {
  if (!t.isMemberExpression(node)) return { success: false };
  if (!node.computed && t.isIdentifier(node.property)) return { success: true, value: node.property.name };
  const property = evaluateStaticNode(node.property);
  if (!property.success) return { success: false };
  return { success: true, value: property.value };
}

function isSupportedStaticValue(value) {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    Array.isArray(value)
  );
}

  eval(dependJsContent);

  decryptReport.aliases = decryptTargets.getAliasNames();
  decryptReport.wrappers = decryptTargets.getWrapperNames();
  traverse(ast, {
    CallExpression(path) {
      if (!decryptTargets.isTargetCall(path)) return;
      decryptReport.targetCalls += 1;

      const decrypted = evaluateDecryptCall(path, DECNAME);
      if (!decrypted.success) {
        if (decrypted.reason === 'static-argument') {
          decryptReport.staticArgumentFailures += 1;
        } else {
          decryptReport.evalFailures += 1;
        }
        return;
      }

      const literalNode = valueToLiteralNode(decrypted.value);
      if (!literalNode) {
        decryptReport.unsupportedResultFailures += 1;
        return;
      }

      path.replaceWith(literalNode);
      decryptReport.replacedCalls += 1;
      path.skip();
    }
  });

  return {
    ast,
    report: decryptReport,
  };

  function evaluateDecryptCall(path, decryptName) {
    try {
      const normalizedCall = decryptTargets.toDecryptCallExpression(path, decryptName);
      if (!normalizedCall) {
        return {
          success: false,
          reason: 'eval',
          error: new Error(`cannot normalize decrypt call: ${path.toString()}`),
        };
      }

      const args = [];
      for (const argument of normalizedCall.arguments) {
        if (t.isSpreadElement(argument)) {
          return {
            success: false,
            reason: 'static-argument',
            error: new Error(`spread argument is not supported: ${generator(normalizedCall).code}`),
          };
        }

        const value = getStaticLiteralNodeValue(argument);
        if (!value.success) {
          return {
            success: false,
            reason: 'static-argument',
            error: value.error,
          };
        }
        args.push(value.value);
      }

      const callExpression = t.callExpression(
        t.cloneNode(normalizedCall.callee, true),
        args.map(valueToLiteralNode)
      );

      return {
        success: true,
        value: eval(generator(callExpression).code),
      };
    } catch (error) {
      return {
        success: false,
        reason: 'eval',
        error,
      };
    }
  }

  function valueToLiteralNode(value) {
    if (typeof value === 'string') return t.stringLiteral(value);
    if (typeof value === 'number' && Number.isFinite(value)) return t.numericLiteral(value);
    if (typeof value === 'boolean') return t.booleanLiteral(value);
    if (value === null) return t.nullLiteral();
    return null;
  }

  function getStaticLiteralValue(path) {
    const evaluated = getStaticValue(path);
    if (!evaluated.success) {
      return {
        success: false,
        error: evaluated.error || new Error(`argument is not static: ${path.toString()}`),
      };
    }

    const value = evaluated.value;
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      value === null ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return {
        success: true,
        value,
      };
    }

    return {
      success: false,
      error: new Error(`unsupported argument value: ${path.toString()}`),
    };
  }

  function getStaticLiteralNodeValue(node) {
    const evaluated = evaluateStaticNode(node);
    if (!evaluated.success) {
      return {
        success: false,
        error: evaluated.error || new Error(`argument is not static: ${generator(node).code}`),
      };
    }

    const value = evaluated.value;
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      value === null ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return {
        success: true,
        value,
      };
    }

    return {
      success: false,
      error: new Error(`unsupported argument value: ${generator(node).code}`),
    };
  }

}

function collectDecryptTargets(ast, decryptName) {
  const aliasBindings = new Set();
  const directCalls = [];
  const aliasCalls = [];
  const wrapperCalls = [];
  const aliasAssignmentPaths = new Map();
  const aliasReadyAt = new Map();
  const containerCallNodes = new WeakSet();
  const wrapperBindings = new Map();
  const wrapperReturnCallNodes = new WeakSet();

  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || !path.node.init) return;
      if (!isDecryptExpression(path.get('init'), decryptName)) return;

      const binding = path.scope.getBinding(path.node.id.name);
      if (!binding || !binding.constant) return;

      addAliasBinding(binding, path.node.end ?? 0);
    },
    AssignmentExpression(path) {
      if (path.node.operator !== '=' || !t.isIdentifier(path.node.left)) return;
      if (!isDecryptExpression(path.get('right'), decryptName)) return;

      const binding = path.scope.getBinding(path.node.left.name);
      if (!binding || binding.constantViolations.length !== 1 || binding.constantViolations[0].node !== path.node) return;

      addAliasBinding(binding, path.node.end ?? 0);
      aliasAssignmentPaths.set(binding, path);
    },
  });

  collectPureWrappers();
  collectContainerAliases();

  traverse(ast, {
    CallExpression(path) {
      if (wrapperReturnCallNodes.has(path.node)) return;

      const calleePath = path.get('callee');
      if (isDecryptExpression(calleePath, decryptName)) {
        directCalls.push(path);
        return;
      }

      if (calleePath.isIdentifier()) {
        const binding = calleePath.scope.getBinding(calleePath.node.name);
        const wrapper = binding ? wrapperBindings.get(binding) : null;
        if (wrapper && isWrapperCallAfterSetup(path, wrapper)) {
          wrapperCalls.push(path);
          return;
        }

        if (binding && aliasBindings.has(binding) && isAliasCallAfterAliasSetup(path, binding)) {
          aliasCalls.push(path);
        }
        return;
      }

      if (containerCallNodes.has(path.node)) {
          aliasCalls.push(path);
      }
    }
  });

  return {
    aliasBindings,
    wrapperBindings,
    calls: directCalls.concat(aliasCalls, wrapperCalls),
    directCalls,
    aliasCalls,
    wrapperCalls,
    isTargetCall(path) {
      if (!path.isCallExpression()) return false;
      if (wrapperReturnCallNodes.has(path.node)) return false;

      const calleePath = path.get('callee');
      if (isDecryptExpression(calleePath, decryptName)) return true;
      if (!calleePath.isIdentifier()) return containerCallNodes.has(path.node);

      const binding = calleePath.scope.getBinding(calleePath.node.name);
      if (!binding) return false;

      const wrapper = wrapperBindings.get(binding);
      if (wrapper && isWrapperCallAfterSetup(path, wrapper)) return true;

      return Boolean(aliasBindings.has(binding) && isAliasCallAfterAliasSetup(path, binding));
    },
    toDecryptCallExpression(path, currentDecryptName) {
      if (!path.isCallExpression()) return null;
      const calleePath = path.get('callee');

      if (isDecryptExpression(calleePath, currentDecryptName) || containerCallNodes.has(path.node)) {
        return t.callExpression(
          parser.parseExpression(currentDecryptName),
          path.node.arguments.map(argument => t.cloneNode(argument, true))
        );
      }

      if (!calleePath.isIdentifier()) return null;
      const binding = calleePath.scope.getBinding(calleePath.node.name);
      if (!binding) return null;

      const wrapper = wrapperBindings.get(binding);
      if (wrapper && isWrapperCallAfterSetup(path, wrapper)) {
        return inlineWrapperCall(wrapper, path.node.arguments, currentDecryptName, 0);
      }

      if (aliasBindings.has(binding) && isAliasCallAfterAliasSetup(path, binding)) {
        return t.callExpression(
          parser.parseExpression(currentDecryptName),
          path.node.arguments.map(argument => t.cloneNode(argument, true))
        );
      }

      return null;
    },
    report() {
      return {
        aliases: getAliasNames(),
        wrappers: getWrapperNames(),
        calls: directCalls.concat(aliasCalls, wrapperCalls).map(path => generator(path.node).code),
      };
    },
    getAliasNames() {
      return getAliasNames();
    },
    getWrapperNames() {
      return getWrapperNames();
    }
  };

  function collectPureWrappers() {
    const candidates = new Map();

    traverse(ast, {
      FunctionDeclaration(path) {
        if (!path.node.id) return;
        const binding = path.scope.getBinding(path.node.id.name);
        const candidate = buildWrapperCandidate(path, binding, null);
        if (candidate) candidates.set(binding, candidate);
      },
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        const initPath = path.get('init');
        if (!initPath.isFunctionExpression() && !initPath.isArrowFunctionExpression()) return;

        const binding = path.scope.getBinding(path.node.id.name);
        const candidate = buildWrapperCandidate(initPath, binding, path.node.end ?? 0);
        if (candidate && binding.constant) candidates.set(binding, candidate);
      },
      AssignmentExpression(path) {
        if (path.node.operator !== '=' || !t.isIdentifier(path.node.left)) return;
        const rightPath = path.get('right');
        if (!rightPath.isFunctionExpression() && !rightPath.isArrowFunctionExpression()) return;

        const binding = path.scope.getBinding(path.node.left.name);
        if (!binding || !canUseAssignmentBinding(binding, path)) return;

        const candidate = buildWrapperCandidate(rightPath, binding, path.node.end ?? 0);
        if (candidate) candidates.set(binding, candidate);
      },
    });

    let changed = true;
    while (changed) {
      changed = false;

      for (const [binding, candidate] of candidates) {
        if (wrapperBindings.has(binding)) continue;

        const returnCallPath = candidate.returnCallPath;
        const calleePath = returnCallPath.get('callee');
        let target = null;

        if (isDecryptExpression(calleePath, decryptName)) {
          target = { kind: 'decrypt' };
        } else if (calleePath.isIdentifier()) {
          const targetBinding = calleePath.scope.getBinding(calleePath.node.name);
          const targetWrapper = targetBinding ? wrapperBindings.get(targetBinding) : null;
          if (targetWrapper) {
            target = {
              kind: 'wrapper',
              wrapper: targetWrapper,
            };
          }
        }

        if (!target) continue;

        if (!returnCallPath.node.arguments.every(argument => !t.isSpreadElement(argument) && isPureWrapperExpression(argument, candidate.paramNames))) {
          continue;
        }

        const wrapper = {
          binding,
          name: binding.identifier.name,
          params: candidate.params,
          paramNames: candidate.paramNames,
          returnCall: returnCallPath.node,
          target,
          readyAt: candidate.readyAt,
        };
        wrapperBindings.set(binding, wrapper);
        wrapperReturnCallNodes.add(returnCallPath.node);
        changed = true;
      }
    }
  }

  function buildWrapperCandidate(functionPath, binding, readyAt) {
    if (!binding || !binding.constant || functionPath.node.async || functionPath.node.generator) return null;

    const params = [];
    const paramNames = new Set();
    for (const param of functionPath.node.params) {
      if (!t.isIdentifier(param) || paramNames.has(param.name)) return null;
      params.push(param.name);
      paramNames.add(param.name);
    }

    const returnCallPath = getSingleReturnCallPath(functionPath);
    if (!returnCallPath) return null;

    return {
      binding,
      params,
      paramNames,
      returnCallPath,
      readyAt,
    };
  }

  function getSingleReturnCallPath(functionPath) {
    const bodyPath = functionPath.get('body');
    if (bodyPath.isCallExpression()) return bodyPath;
    if (!bodyPath.isBlockStatement()) return null;

    const body = bodyPath.get('body');
    if (body.length !== 1 || !body[0].isReturnStatement()) return null;

    const argumentPath = body[0].get('argument');
    return argumentPath.isCallExpression() ? argumentPath : null;
  }

  function isPureWrapperExpression(node, paramNames) {
    if (
      t.isNumericLiteral(node) ||
      t.isStringLiteral(node) ||
      t.isBooleanLiteral(node) ||
      t.isNullLiteral(node)
    ) {
      return true;
    }

    if (t.isIdentifier(node)) {
      return paramNames.has(node.name) || node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity';
    }

    if (t.isUnaryExpression(node)) return isPureWrapperExpression(node.argument, paramNames);
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      return isPureWrapperExpression(node.left, paramNames) && isPureWrapperExpression(node.right, paramNames);
    }
    if (t.isConditionalExpression(node)) {
      return (
        isPureWrapperExpression(node.test, paramNames) &&
        isPureWrapperExpression(node.consequent, paramNames) &&
        isPureWrapperExpression(node.alternate, paramNames)
      );
    }
    if (t.isSequenceExpression(node)) {
      return node.expressions.every(expression => isPureWrapperExpression(expression, paramNames));
    }
    if (t.isTemplateLiteral(node)) {
      return node.expressions.every(expression => isPureWrapperExpression(expression, paramNames));
    }
    if (t.isArrayExpression(node)) {
      return node.elements.every(element => element && isPureWrapperExpression(element, paramNames));
    }

    return evaluateStaticNode(node).success;
  }

  function inlineWrapperCall(wrapper, callArguments, currentDecryptName, depth) {
    if (depth > 12) return null;

    const replacements = new Map();
    for (let index = 0; index < wrapper.params.length; index += 1) {
      replacements.set(
        wrapper.params[index],
        callArguments[index] ? t.cloneNode(callArguments[index], true) : t.identifier('undefined')
      );
    }

    const normalizedArguments = wrapper.returnCall.arguments.map(argument => substituteWrapperParams(argument, replacements));
    if (wrapper.target.kind === 'decrypt') {
      return t.callExpression(parser.parseExpression(currentDecryptName), normalizedArguments);
    }

    return inlineWrapperCall(wrapper.target.wrapper, normalizedArguments, currentDecryptName, depth + 1);
  }

  function substituteWrapperParams(node, replacements) {
    if (t.isIdentifier(node) && replacements.has(node.name)) {
      return t.cloneNode(replacements.get(node.name), true);
    }

    const cloned = t.cloneNode(node, false);
    const keys = t.VISITOR_KEYS[node.type] || [];
    for (const key of keys) {
      const value = node[key];
      if (Array.isArray(value)) {
        cloned[key] = value.map(item => item && typeof item.type === 'string' ? substituteWrapperParams(item, replacements) : item);
      } else if (value && typeof value.type === 'string') {
        cloned[key] = substituteWrapperParams(value, replacements);
      }
    }
    return cloned;
  }

  function isWrapperCallAfterSetup(callPath, wrapper) {
    if (wrapper.readyAt === null || wrapper.readyAt === undefined) return true;
    return (callPath.node.start ?? 0) > wrapper.readyAt;
  }

  function collectContainerAliases() {
    traverse(ast, {
      Program(path) {
        scanBody(path.get('body'));
      },
      BlockStatement(path) {
        scanBody(path.get('body'));
      }
    });
  }

  function scanBody(bodyPaths) {
    const arrays = new Map();
    const localAliases = new Set();

    for (const statementPath of bodyPaths) {
      if (statementPath.isVariableDeclaration()) {
        const declarations = statementPath.get('declarations');
        for (const declarator of declarations) {
          const initPath = declarator.get('init');
          if (initPath.node) {
            collectContainerCallsInPath(initPath, arrays, localAliases);
          }
          scanDeclarator(declarator, arrays, localAliases);
        }
        continue;
      }

      if (statementPath.isExpressionStatement()) {
        const expressionPath = statementPath.get('expression');
        collectContainerCallsInPath(expressionPath, arrays, localAliases);
        scanExpression(expressionPath, arrays, localAliases);
        continue;
      }

      if (statementPath.isReturnStatement() || statementPath.isThrowStatement()) {
        const argumentPath = statementPath.get('argument');
        if (argumentPath.node) {
          collectContainerCallsInPath(argumentPath, arrays, localAliases);
          invalidateEscapedArrays(argumentPath, arrays);
        }
        continue;
      }

      if (statementPath.isFunctionDeclaration() || statementPath.isClassDeclaration() || statementPath.isEmptyStatement()) {
        continue;
      }

      invalidateAllArrays(arrays);
    }
  }

  function scanDeclarator(declaratorPath, arrays, localAliases) {
    if (!t.isIdentifier(declaratorPath.node.id)) {
      const initPath = declaratorPath.get('init');
      if (initPath.node) invalidateEscapedArrays(initPath, arrays);
      return;
    }

    const binding = declaratorPath.scope.getBinding(declaratorPath.node.id.name);
    const initPath = declaratorPath.get('init');
    if (!binding || !initPath.node) return;

    const symbolicValue = resolveSymbolicValue(initPath, arrays, localAliases);
    if (symbolicValue?.kind === 'decrypt' && binding.constant) {
      addAliasBinding(binding, declaratorPath.node.end ?? 0);
      localAliases.add(binding);
      return;
    }

    const symbolicArray = resolveSymbolicArray(initPath, arrays, localAliases);
    if (symbolicArray && binding.constant) {
      arrays.set(binding, symbolicArray);
      return;
    }

    if (arrays.has(binding)) {
      arrays.delete(binding);
    }
    invalidateEscapedArrays(initPath, arrays);
  }

  function scanExpression(expressionPath, arrays, localAliases) {
    if (expressionPath.isAssignmentExpression({ operator: '=' })) {
      scanAssignmentExpression(expressionPath, arrays, localAliases);
      return;
    }

    if (expressionPath.isCallExpression()) {
      if (scanArrayMutationCall(expressionPath, arrays, localAliases)) return;
      invalidateEscapedArrays(expressionPath, arrays);
      return;
    }

    invalidateEscapedArrays(expressionPath, arrays);
  }

  function scanAssignmentExpression(assignmentPath, arrays, localAliases) {
    const leftPath = assignmentPath.get('left');
    const rightPath = assignmentPath.get('right');

    if (leftPath.isIdentifier()) {
      const binding = leftPath.scope.getBinding(leftPath.node.name);
      if (!binding || !canUseAssignmentBinding(binding, assignmentPath)) {
        invalidateEscapedArrays(rightPath, arrays);
        return;
      }

      const symbolicValue = resolveSymbolicValue(rightPath, arrays, localAliases);
      if (symbolicValue?.kind === 'decrypt') {
        addAliasBinding(binding, assignmentPath.node.end ?? 0);
        aliasAssignmentPaths.set(binding, assignmentPath);
        localAliases.add(binding);
        return;
      }

      const symbolicArray = resolveSymbolicArray(rightPath, arrays, localAliases);
      if (symbolicArray) {
        arrays.set(binding, symbolicArray);
        return;
      }

      arrays.delete(binding);
      invalidateEscapedArrays(rightPath, arrays);
      return;
    }

    if (leftPath.isMemberExpression()) {
      const arrayBinding = getSymbolicArrayBinding(leftPath.get('object'), arrays);
      if (arrayBinding) arrays.delete(arrayBinding);
    }

    invalidateEscapedArrays(assignmentPath, arrays);
  }

  function scanArrayMutationCall(callPath, arrays, localAliases) {
    const calleePath = callPath.get('callee');
    if (!calleePath.isMemberExpression()) return false;

    const arrayBinding = getSymbolicArrayBinding(calleePath.get('object'), arrays);
    if (!arrayBinding) return false;

    const methodName = getStaticMemberName(calleePath.node);
    const current = arrays.get(arrayBinding);
    if (!current || !methodName) {
      arrays.delete(arrayBinding);
      return true;
    }

    if (methodName === 'shift') {
      if (callPath.node.arguments.length !== 0) {
        arrays.delete(arrayBinding);
        return true;
      }
      current.shift();
      return true;
    }

    if (methodName === 'pop') {
      if (callPath.node.arguments.length !== 0) {
        arrays.delete(arrayBinding);
        return true;
      }
      current.pop();
      return true;
    }

    if (methodName === 'push' || methodName === 'unshift') {
      const values = [];
      for (const argumentPath of callPath.get('arguments')) {
        const symbolicValue = resolveSymbolicValue(argumentPath, arrays, localAliases);
        if (!symbolicValue) {
          arrays.delete(arrayBinding);
          return true;
        }
        values.push(symbolicValue);
      }

      if (methodName === 'push') {
        current.push(...values);
      } else {
        current.unshift(...values);
      }
      return true;
    }

    arrays.delete(arrayBinding);
    return true;
  }

  function collectContainerCallsInPath(rootPath, arrays, localAliases) {
    if (rootPath.isCallExpression() && resolveCallCalleeAsDecrypt(rootPath, arrays, localAliases)) {
      containerCallNodes.add(rootPath.node);
    }

    rootPath.traverse({
      Function(path) {
        path.skip();
      },
      Class(path) {
        path.skip();
      },
      CallExpression(path) {
        if (resolveCallCalleeAsDecrypt(path, arrays, localAliases)) {
          containerCallNodes.add(path.node);
        }
      }
    });
  }

  function resolveCallCalleeAsDecrypt(callPath, arrays, localAliases) {
    const calleePath = callPath.get('callee');
    if (isDecryptExpression(calleePath, decryptName)) return true;

    if (calleePath.isIdentifier()) {
      const binding = calleePath.scope.getBinding(calleePath.node.name);
      return Boolean(binding && localAliases.has(binding) && isAliasCallAfterAliasSetup(callPath, binding));
    }

    const symbolicValue = resolveSymbolicValue(calleePath, arrays, localAliases);
    return symbolicValue?.kind === 'decrypt';
  }

  function resolveSymbolicArray(expressionPath, arrays, localAliases) {
    if (expressionPath.isArrayExpression()) {
      const items = [];
      for (const elementPath of expressionPath.get('elements')) {
        if (!elementPath.node) return null;
        const item = resolveSymbolicValue(elementPath, arrays, localAliases);
        if (!item) return null;
        items.push(item);
      }
      return items;
    }

    if (expressionPath.isIdentifier()) {
      const binding = expressionPath.scope.getBinding(expressionPath.node.name);
      const existing = binding ? arrays.get(binding) : null;
      return existing ? existing.slice() : null;
    }

    if (!expressionPath.isCallExpression()) return null;
    const calleePath = expressionPath.get('callee');
    if (!calleePath.isMemberExpression()) return null;
    if (getStaticMemberName(calleePath.node) !== 'concat') return null;

    const base = resolveSymbolicArray(calleePath.get('object'), arrays, localAliases);
    if (!base) return null;

    const items = base.slice();
    for (const argumentPath of expressionPath.get('arguments')) {
      if (argumentPath.isSpreadElement()) return null;

      const argumentArray = resolveSymbolicArray(argumentPath, arrays, localAliases);
      if (argumentArray) {
        items.push(...argumentArray);
        continue;
      }

      const argumentValue = resolveSymbolicValue(argumentPath, arrays, localAliases);
      if (!argumentValue) return null;
      items.push(argumentValue);
    }

    return items;
  }

  function resolveSymbolicValue(expressionPath, arrays, localAliases) {
    if (isDecryptAliasExpression(expressionPath, localAliases)) {
      return { kind: 'decrypt' };
    }

    if (isSafeStaticSymbol(expressionPath)) {
      return { kind: 'static' };
    }

    if (expressionPath.isMemberExpression()) {
      const arrayBinding = getSymbolicArrayBinding(expressionPath.get('object'), arrays);
      if (!arrayBinding) return null;

      const index = getStaticArrayIndex(expressionPath.get('property'), expressionPath.node.computed);
      if (index === null) return null;

      const symbolicArray = arrays.get(arrayBinding);
      return symbolicArray?.[index] || null;
    }

    return null;
  }

  function isDecryptAliasExpression(expressionPath, localAliases) {
    if (isDecryptExpression(expressionPath, decryptName)) return true;
    if (!expressionPath.isIdentifier()) return false;

    const binding = expressionPath.scope.getBinding(expressionPath.node.name);
    return Boolean(binding && localAliases.has(binding));
  }

  function getSymbolicArrayBinding(expressionPath, arrays) {
    if (!expressionPath.isIdentifier()) return null;
    const binding = expressionPath.scope.getBinding(expressionPath.node.name);
    return binding && arrays.has(binding) ? binding : null;
  }

  function getStaticArrayIndex(propertyPath, computed) {
    if (!computed) {
      if (!propertyPath.isNumericLiteral()) return null;
      return propertyPath.node.value;
    }

    if (propertyPath.isNumericLiteral()) {
      return Number.isInteger(propertyPath.node.value) && propertyPath.node.value >= 0 ? propertyPath.node.value : null;
    }

    if (propertyPath.isStringLiteral() && /^(0|[1-9]\d*)$/.test(propertyPath.node.value)) {
      return Number(propertyPath.node.value);
    }

    return null;
  }

  function getStaticMemberName(node) {
    if (!t.isMemberExpression(node)) return null;
    if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
    if (node.computed && t.isStringLiteral(node.property)) return node.property.value;
    return null;
  }

  function isSafeStaticSymbol(expressionPath) {
    if (
      expressionPath.isStringLiteral() ||
      expressionPath.isNumericLiteral() ||
      expressionPath.isBooleanLiteral() ||
      expressionPath.isNullLiteral()
    ) {
      return true;
    }

    const evaluated = expressionPath.evaluate();
    return (
      evaluated.confident &&
      (
        typeof evaluated.value === 'string' ||
        typeof evaluated.value === 'boolean' ||
        evaluated.value === null ||
        (typeof evaluated.value === 'number' && Number.isFinite(evaluated.value))
      )
    );
  }

  function invalidateEscapedArrays(rootPath, arrays) {
    if (arrays.size === 0 || !rootPath.node) return;

    const escaped = new Set();
    collectInvalidatedArrayBindings(rootPath, arrays, escaped);
    for (const binding of escaped) {
      arrays.delete(binding);
    }
  }

  function collectInvalidatedArrayBindings(rootPath, arrays, escaped) {
    function markIfArray(identifierPath) {
      const binding = getSymbolicArrayBinding(identifierPath, arrays);
      if (binding) escaped.add(binding);
    }

    if (rootPath.isAssignmentExpression()) {
      const leftPath = rootPath.get('left');
      if (leftPath.isIdentifier()) markIfArray(leftPath);
      if (leftPath.isMemberExpression()) markIfArray(leftPath.get('object'));
    }

    if (rootPath.isUpdateExpression()) {
      const argumentPath = rootPath.get('argument');
      if (argumentPath.isIdentifier()) markIfArray(argumentPath);
      if (argumentPath.isMemberExpression()) markIfArray(argumentPath.get('object'));
    }

    if (rootPath.isUnaryExpression({ operator: 'delete' })) {
      const argumentPath = rootPath.get('argument');
      if (argumentPath.isIdentifier()) markIfArray(argumentPath);
      if (argumentPath.isMemberExpression()) markIfArray(argumentPath.get('object'));
    }

    if (rootPath.isCallExpression() || rootPath.isNewExpression()) {
      if (rootPath.isCallExpression() && isEvalCall(rootPath)) {
        invalidateAllArrays(arrays);
        return;
      }
      for (const argumentPath of rootPath.get('arguments')) {
        if (argumentPath.isIdentifier()) markIfArray(argumentPath);
      }
    }

    rootPath.traverse({
      Function(path) {
        path.skip();
      },
      Class(path) {
        path.skip();
      },
      AssignmentExpression(path) {
        const leftPath = path.get('left');
        if (leftPath.isIdentifier()) markIfArray(leftPath);
        if (leftPath.isMemberExpression()) markIfArray(leftPath.get('object'));
      },
      UpdateExpression(path) {
        const argumentPath = path.get('argument');
        if (argumentPath.isIdentifier()) markIfArray(argumentPath);
        if (argumentPath.isMemberExpression()) markIfArray(argumentPath.get('object'));
      },
      UnaryExpression(path) {
        if (!path.isUnaryExpression({ operator: 'delete' })) return;
        const argumentPath = path.get('argument');
        if (argumentPath.isIdentifier()) markIfArray(argumentPath);
        if (argumentPath.isMemberExpression()) markIfArray(argumentPath.get('object'));
      },
      CallExpression(path) {
        if (isEvalCall(path)) {
          invalidateAllArrays(arrays);
          path.stop();
          return;
        }
        for (const argumentPath of path.get('arguments')) {
          if (argumentPath.isIdentifier()) markIfArray(argumentPath);
        }
      },
      NewExpression(path) {
        for (const argumentPath of path.get('arguments')) {
          if (argumentPath.isIdentifier()) markIfArray(argumentPath);
        }
      },
      WithStatement(path) {
        invalidateAllArrays(arrays);
        path.stop();
      }
    });
  }

  function invalidateAllArrays(arrays) {
    arrays.clear();
  }

  function isEvalCall(path) {
    return path.get('callee').isIdentifier({ name: 'eval' });
  }

  function canUseAssignmentBinding(binding, assignmentPath) {
    return binding.constantViolations.length === 1 && binding.constantViolations[0].node === assignmentPath.node;
  }

  function addAliasBinding(binding, readyAt) {
    aliasBindings.add(binding);
    const previous = aliasReadyAt.get(binding);
    if (previous === undefined || readyAt < previous) {
      aliasReadyAt.set(binding, readyAt);
    }
  }

  function isAliasCallAfterAliasSetup(callPath, binding) {
    const assignmentPath = aliasAssignmentPaths.get(binding);
    const readyAt = aliasReadyAt.get(binding);
    if (!assignmentPath && readyAt === undefined) return true;
    const callStart = callPath.node.start ?? 0;
    const aliasEnd = readyAt ?? assignmentPath.node.end ?? 0;
    return callStart > aliasEnd;
  }

  function getAliasNames() {
    return Array.from(new Set(Array.from(aliasBindings, binding => binding.identifier.name)));
  }

  function getWrapperNames() {
    return Array.from(new Set(Array.from(wrapperBindings.values(), wrapper => wrapper.name)));
  }
}

function isDecryptExpression(expressionPath, decryptName) {
  if (expressionPath.isIdentifier({ name: decryptName })) return true;
  return generator(expressionPath.node).code === decryptName;
}

function runSelfCheck() {
  const childProcess = require('child_process');
  const os = require('os');

  const defaultDependJsContent = [
    'function dec(index) {',
    '  return ["zero", "one", "two", "three", "four", true, null, 42][index];',
    '}',
  ].join('\n');

  const memberDependJsContent = [
    'var api = {};',
    'api.dec = function (index) {',
    '  return ["zero", "one", "two", "three", "four"][index];',
    '};',
  ].join('\n');

  const testCases = [
    {
      name: 'direct numeric decrypt call',
      input: 'var x = dec(1);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'static expression argument',
      input: 'var x = dec(0x10 - 15);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal identifier key',
      input: 'var m = { a: 1 }; var x = dec(m.a);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal string key bracket access',
      input: 'var m = { "a": 1 }; var x = dec(m["a"]);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal arithmetic value',
      input: 'var m = { a: 0x5 - 1 }; var x = dec(m.a);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal string length value',
      input: 'var m = { a: "abcd".length }; var x = dec(m.a);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal same declaration later declarator',
      input: 'var m = { a: 2 }, helper = 1, x = dec(m.a);',
      includes: ['x = "two"'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal same declaration alias',
      input: 'var m = { a: 1 }, alias = m; var x = dec(alias.a);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal later statement alias',
      input: 'var m = { a: 2 }; var alias = m; var x = dec(alias.a);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal used in return expression',
      input: 'function f() { var m = { a: 3 }; return { x: dec(m.a) }; }',
      includes: ['x: "three"'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal string charCodeAt value',
      input: 'var m = { a: "A".charCodeAt(0) - 64 }; var x = dec(m.a);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal String.fromCharCode length value',
      input: 'var m = { a: String.fromCharCode(65, 66).length }; var x = dec(m.a);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'object literal Number constant expression',
      input: 'var m = { a: Number.MAX_SAFE_INTEGER > 1 ? 4 : 1 }; var x = dec(m.a);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'decrypt argument template literal expression',
      depend: 'function dec(value) { return value; }',
      input: 'var x = dec(`a${1 + 2}`);',
      includes: ['var x = "a3";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'assignment object literal map',
      input: 'm = { a: 2 }; var x = dec(m.a);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'incremental var object map',
      input: 'var m = {}; m.a = 3; var x = dec(m.a);',
      includes: ['var x = "three";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'incremental assignment object map',
      input: 'm = {}; m.a = 4; var x = dec(m.a);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'incremental map skips pure declarations',
      input: 'var m = {}; var local = 1; const size = "abc".length; m.a = 4; var x = dec(m.a);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'incremental map object alias',
      input: 'var m = {}; var alias = m; alias.a = 1; var x = dec(m.a);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'identifier decrypt alias',
      input: 'var alias = dec; var x = alias(2);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'member decrypt direct call',
      decryptName: 'api.dec',
      depend: memberDependJsContent,
      input: 'var x = api.dec(2);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'member decrypt var alias',
      decryptName: 'api.dec',
      depend: memberDependJsContent,
      input: 'var m = { a: 1 }; var alias = api.dec; var x = alias(m.a);',
      includes: ['var x = "one";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'member decrypt assignment alias',
      decryptName: 'api.dec',
      depend: memberDependJsContent,
      input: 'var alias; alias = api.dec; var x = alias(3);',
      includes: ['var x = "three";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'decrypt alias through concat array index',
      input: 'var alias = dec, arr = ["junk"].concat(alias), call = arr[1]; var x = call(2);',
      includes: ['var x = "two";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'decrypt alias through shifted concat array',
      input: 'var alias = dec, arr = ["junk"].concat(alias), call1 = arr[1]; arr.shift(); var call2 = arr[0]; var x = call1(2), y = call2(3);',
      includes: ['x = "two"', 'y = "three"'],
      report: { targetCalls: 2, replacedCalls: 2 },
    },
    {
      name: 'decrypt alias direct call through array member',
      input: 'var alias = dec, arr = ["junk"].concat(alias); arr.shift(); var x = arr[0](4);',
      includes: ['var x = "four";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'decrypt alias array dynamic index rejected',
      input: 'var alias = dec, arr = ["junk"].concat(alias), i = 1, call = arr[i]; var x = call(2);',
      includes: ['var x = call(2);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'decrypt alias array escaped to call rejected',
      input: 'var alias = dec, arr = ["junk"].concat(alias); touch(arr); var call = arr[1]; var x = call(2);',
      includes: ['var x = call(2);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'decrypt alias array unknown method rejected',
      input: 'var alias = dec, arr = ["junk"].concat(alias); arr.reverse(); var call = arr[0]; var x = call(2);',
      includes: ['var x = call(2);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'decrypt alias array does not cross into shadowed function',
      input: 'var alias = dec, arr = ["junk"].concat(alias); function f() { var arr = ["junk", other], call = arr[1]; var x = call(2); }',
      includes: ['var x = call(2);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'normal function through array is rejected',
      input: 'function wrap(x) { return x; } var arr = ["junk"].concat(wrap), call = arr[1]; var x = call(2);',
      includes: ['var x = call(2);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'pure decrypt wrapper with offset argument',
      input: 'function wrap(a, b) { return dec(a + 1, b); } var x = wrap(0, "k");',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = "k:1";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'ob style pure decrypt wrapper with reordered params',
      input: 'function q(a, b, c, d, e) { return dec(e - 1, c); } var x = q(1, 2, "k", 4, 2);',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = "k:1";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'nested pure decrypt wrappers',
      input: 'function a(x, y) { return dec(x + 1, y); } function b(p, q) { return a(q - 1, p); } var x = b("k", 1);',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = "k:1";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'pure decrypt wrapper arrow expression',
      input: 'const wrap = (a, b) => dec(a + 1, b); var x = wrap(0, "k");',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = "k:1";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'pure decrypt wrapper dynamic argument rejected',
      input: 'function wrap(a, b) { return dec(a + 1, b); } var y = 1; var x = wrap(y, "k");',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = wrap(y, "k");'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'multi statement decrypt wrapper rejected',
      input: 'function wrap(a, b) { var n = a + 1; return dec(n, b); } var x = wrap(0, "k");',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = wrap(0, "k");'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'decrypt wrapper with free identifier rejected',
      input: 'var off = 1; function wrap(a, b) { return dec(a + off, b); } var x = wrap(0, "k");',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      includes: ['var x = wrap(0, "k");'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'shadowed decrypt wrapper remains non target',
      input: 'function wrap(a) { return dec(a); } function f() { function wrap(a) { return other(a); } var x = wrap(1); }',
      includes: ['var x = wrap(1);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'two static decrypt arguments',
      depend: 'function dec(index, prefix) { return prefix + ":" + index; }',
      input: 'var x = dec(1, "k");',
      includes: ['var x = "k:1";'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'boolean decrypt result',
      input: 'var x = dec(5);',
      includes: ['var x = true;'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'null decrypt result',
      input: 'var x = dec(6);',
      includes: ['var x = null;'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'numeric decrypt result',
      input: 'var x = dec(7);',
      includes: ['var x = 42;'],
      report: { targetCalls: 1, replacedCalls: 1 },
    },
    {
      name: 'non target call remains untouched',
      input: 'var x = other(1);',
      includes: ['var x = other(1);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'non static argument is not executed',
      input: 'function side() { throw new Error("should not run"); } var x = dec(side());',
      includes: ['var x = dec(side());'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'dynamic map property remains',
      input: 'var m = { a: 1 }; var key = "a"; var x = dec(m[key]);',
      includes: ['var x = dec(m[key]);'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'object map invalidated by write',
      input: 'var m = { a: 1 }; m.a = 2; var x = dec(m.a);',
      includes: ['var x = dec(m.a);'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'object map invalidated by call argument',
      input: 'var m = { a: 1 }; touch(m); var x = dec(m.a);',
      includes: ['var x = dec(m.a);'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'inner alias shadowing remains non target',
      input: 'var alias = dec; function f() { var alias = other; var x = alias(1); }',
      includes: ['var x = alias(1);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'reassigned alias remains non target',
      input: 'var alias = dec; alias = other; var x = alias(1);',
      includes: ['var x = alias(1);'],
      report: { targetCalls: 0, replacedCalls: 0 },
    },
    {
      name: 'non numeric object literal map is rejected',
      input: 'var m = { a: 1, b: "x" }; var x = dec(m.a);',
      includes: ['var x = dec(m.a);'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'computed object literal key is rejected',
      input: 'var m = { ["a"]: 1 }; var x = dec(m.a);',
      includes: ['var x = dec(m.a);'],
      report: { targetCalls: 1, replacedCalls: 0, staticArgumentFailures: 1 },
    },
    {
      name: 'decrypt eval failure leaves call',
      depend: 'function dec() { throw new Error("boom"); }',
      input: 'var x = dec(1);',
      includes: ['var x = dec(1);'],
      report: { targetCalls: 1, replacedCalls: 0, evalFailures: 1 },
    },
    {
      name: 'unsupported decrypt result leaves call',
      depend: 'function dec() { return { value: 1 }; }',
      input: 'var x = dec(1);',
      includes: ['var x = dec(1);'],
      report: { targetCalls: 1, replacedCalls: 0, unsupportedResultFailures: 1 },
    },
  ];

  for (const testCase of testCases) {
    const result = runTransform(testCase.input, testCase.decryptName || 'dec', testCase.depend || defaultDependJsContent);
    for (const expected of testCase.includes || []) {
      assertIncludes(testCase.name, result.code, expected);
    }
    for (const unexpected of testCase.excludes || []) {
      assertNotIncludes(testCase.name, result.code, unexpected);
    }
    assertReport(testCase.name, result.report, testCase.report || {});
  }

  const targetAst = parseJavaScript([
    'var api = {};',
    'api.dec = function (i) { return i; };',
    'var alias = api.dec;',
    'var alias2;',
    'alias2 = api.dec;',
    'api.dec(1);',
    'alias(2);',
    'alias2(3);',
    'function f() { var alias = other; alias(3); }',
  ].join('\n'));
  const targets = collectDecryptTargets(targetAst, 'api.dec').report();
  if (targets.aliases.join(',') !== 'alias,alias2' || targets.calls.join('|') !== 'api.dec(1)|alias(2)|alias2(3)') {
    throw new Error(`decrypt target self-check failed: ${JSON.stringify(targets)}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deobfuscate-self-check-'));
  try {
    const inputFile = path.join(tmpDir, 'input.js');
    const outputFile = path.join(tmpDir, 'output.js');
    const dependFile = path.join(tmpDir, 'depend.js');
    const reportFile = path.join(tmpDir, 'report.json');
    fs.writeFileSync(inputFile, 'var m = { a: 1 }; var x = dec(m.a);', 'utf8');
    fs.writeFileSync(dependFile, defaultDependJsContent, 'utf8');

    const stdout = childProcess.execFileSync(process.execPath, [
      __filename,
      '--input', inputFile,
      '--output', outputFile,
      '--depend', dependFile,
      '--decrypt', 'dec',
      '--report-out', reportFile,
    ], { encoding: 'utf8' });

    const outputCode = fs.readFileSync(outputFile, 'utf8');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const stdoutReport = JSON.parse(stdout);

    assertIncludes('cli smoke output', outputCode, 'var x = "one";');
    if (report.decryptReports[0].replacedCalls !== 1 || stdoutReport.decryptReports[0].replacedCalls !== 1) {
      throw new Error(`cli smoke report failed: ${JSON.stringify({ report, stdoutReport })}`);
    }
  } finally {
    const resolvedTmpDir = path.resolve(tmpDir);
    const resolvedOsTmpDir = path.resolve(os.tmpdir());
    if (resolvedTmpDir.startsWith(resolvedOsTmpDir + path.sep)) {
      fs.rmSync(resolvedTmpDir, { recursive: true, force: true });
    }
  }

  console.log(`deobfuscate self-check passed (${testCases.length + 2} checks)`);

  function runTransform(inputCode, decryptName, dependJsContent) {
    const result = De_string_arraying_obfuscation(parseJavaScript(inputCode), decryptName, dependJsContent);
    return {
      code: generator(result.ast).code,
      report: result.report,
    };
  }

  function assertIncludes(name, code, expected) {
    if (!code.includes(expected)) {
      throw new Error(`${name} failed: expected ${JSON.stringify(expected)} in ${code}`);
    }
  }

  function assertNotIncludes(name, code, unexpected) {
    if (code.includes(unexpected)) {
      throw new Error(`${name} failed: did not expect ${JSON.stringify(unexpected)} in ${code}`);
    }
  }

  function assertReport(name, report, expected) {
    for (const key of Object.keys(expected)) {
      if (report[key] !== expected[key]) {
        throw new Error(`${name} report failed: expected ${key}=${expected[key]}, got ${report[key]} in ${JSON.stringify(report)}`);
      }
    }
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
