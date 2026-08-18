#!/usr/bin/env node
'use strict';
/* dispatcher_probe.cjs — 结构无关的 JSVMP「派发循环定位器 + handler 抽取器 + 诊断」。站点无关。
 *
 * 动机：jsvmp_split_dispatcher（老）只认 switch-case 派发；遇到 if-else 链 / 跳转表派发就回 0、链路断、
 * Agent 拿空表瞎试。本工具补上：① 用**通用结构 + 数据流特征**定位真正的派发循环（跳过控制流平坦化的假
 * switch 外壳），② 判断派发结构（switch / if-else 链 / 跳转表），③ 抽出 opcode→handler 映射，④ 失败也给诊断。
 *
 * ★硬约束（与方法论站点无关红线一致）：识别**只**靠 AST 结构 + 数据流，
 *   绝不匹配任何具体变量名 / opcode 数值 / magic 头 / 算法常量（XXTEA delta 之类）。换个 dispatcher 照样用。
 *
 * 用法: node dispatcher_probe.cjs <input.js> <out.json>
 * 输出 stdout: __PROBE_JSON__<json 摘要>；完整写 <out.json>。
 * 需要: acorn（backend 自动 npm install，同 js_trace）。
 */
const fs = require('fs');

function emit(o) {
  try { if (OUT) fs.writeFileSync(OUT, JSON.stringify(o, null, 2)); } catch {}
  console.log('__PROBE_JSON__' + JSON.stringify(o.ok === false ? o : summarize(o)));
  process.exit(0);
}
function summarize(o) {
  return {
    ok: o.ok, found: o.found, structure: o.structure,
    opCount: o.handlers ? Object.keys(o.handlers).length : 0,
    opKeysPreview: o.handlers ? Object.keys(o.handlers).slice(0, 24).join(',') : '',
    rangeGroups: (o.rangeGroups || []).length,
    dispatchLoop: o.dispatchLoop, decode: o.decode, jumpTable: o.jumpTable,
    candidates: (o.candidates || []).slice(0, 5), diagnostics: o.diagnostics,
  };
}

const OUT = process.argv[3];
const IN = process.argv[2];
let acorn;
try { acorn = require('acorn'); } catch (e) {
  emit({ ok: false, error: 'acorn 未安装；backend 会自动 npm install acorn，装好后重试。' });
}
if (!IN) emit({ ok: false, error: '用法: dispatcher_probe.cjs <input.js> <out.json>' });
const src = fs.readFileSync(IN, 'utf8');

// 容错解析：dispatcher 源码可能是完整函数 / 函数体片段 / 带 return。逐个包法试。
function parse(code) {
  const tries = [code, '(' + code + ')', 'function __w__(){\n' + code + '\n}', 'var __w__=' + code];
  for (const t of tries) {
    try { return acorn.parse(t, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowSuperOutsideMethod: true }); } catch {}
  }
  return null;
}
const ast = parse(src);
if (!ast) emit({ ok: false, error: '解析失败：acorn 无法 parse 这段源码（确认是完整 JS 片段，别是被截断的半截）。' });

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit); }
    else if (v && typeof v.type === 'string') walk(v, visit);
  }
}
function snippet(n, cap = 220) { return src.slice(n.start, Math.min(n.end, n.start + cap)); }
function lineOf(pos) { return src.slice(0, pos).split('\n').length; }
function usesVar(node, name) { let f = false; walk(node, x => { if (x.type === 'Identifier' && x.name === name) f = true; }); return f; }
function litKey(node) {
  if (!node) return null;
  if (node.type === 'Literal' && (typeof node.value === 'number' || typeof node.value === 'string')) return normKey(node.value);
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') return normKey(-node.argument.value);
  return null;
}
function normKey(v) { return typeof v === 'number' ? '0x' + (v >>> 0).toString(16) : String(v); }

// ── 收集所有循环，逐个按「派发循环」特征打分（纯结构/数据流） ──
const loops = [];
walk(ast, n => { if (/^(While|DoWhile|For|ForOf|ForIn)Statement$/.test(n.type)) loops.push(n); });

function analyze(loop) {
  const body = loop.body || loop;
  // ① PC 候选：循环体里被 ++ / += / = v±常量 的变量（程序计数器自增）
  const incVars = new Set();
  walk(body, n => {
    if (n.type === 'UpdateExpression' && n.argument && n.argument.type === 'Identifier') incVars.add(n.argument.name);
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
      if (n.operator === '+=' || n.operator === '-=') incVars.add(n.left.name);
      if (n.operator === '=' && n.right.type === 'BinaryExpression' && usesVar(n.right, n.left.name)) incVars.add(n.left.name);
    }
  });
  // ② 按 PC 下标读取的「字节码源」：X[<含PC的表达式>]（含 X[pc]、X[pc++]、X[pc]+X[pc+1] 等）
  let pcVar = null, srcArr = null, readNode = null;
  walk(body, n => {
    if (n.type === 'MemberExpression' && n.computed && n.object.type === 'Identifier' && !/^(this)$/.test(n.object.name)) {
      for (const v of incVars) {
        if (usesVar(n.property, v)) { if (!pcVar) { pcVar = v; srcArr = n.object.name; readNode = n; } }
      }
    }
  });
  if (!pcVar || !srcArr) return { score: 0 };
  let score = 2; // 有 PC 自增 + 按 PC 取值 = 强信号

  // ③ opVar：把「按 PC 读到的值」存进的变量（var op = parseInt(code[pc]+code[pc+1],16) / op = code[pc++]）
  let opVar = null;
  walk(body, n => {
    if (!opVar && n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && usesVar(n.init, srcArr) && usesVar(n.init, pcVar)) opVar = n.id.name;
    if (!opVar && n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier' && n.right && usesVar(n.right, srcArr) && usesVar(n.right, pcVar)) opVar = n.left.name;
  });

  // ④ handler 抽取：**全派发循环范围一次性收集**（switch case + if(cmpVar===lit) + 范围分组），
  //    不沿 else-if 单链、不 switch/if 二选一。真实大派发块(90+ op)被混淆器打散成「平铺独立 if / 嵌套分组 /
  //    比较间夹语句 / 混写」，沿单链一条道走只能抽到第一个就断（实战 50KB 块只抽出 1 个＝栽这）。
  const handlers = {};
  let structure = null, jumpTable = null, rangeGroups = [];

  // 定 opcode 锚变量 cmpVar：优先定位器给的 opVar；否则取被「===字面量 / switch」用得最多的那个变量（AST 角色，无名也行）。
  const cmpCount = {};
  walk(body, n => {
    if (n.type === 'IfStatement') for (const v of cmpVarsOf(n.test)) cmpCount[v] = (cmpCount[v] || 0) + 1;
    if (n.type === 'SwitchStatement' && n.discriminant.type === 'Identifier') cmpCount[n.discriminant.name] = (cmpCount[n.discriminant.name] || 0) + (n.cases ? n.cases.length : 0);
  });
  let cmpVar = (opVar && cmpCount[opVar]) ? opVar : null;
  if (!cmpVar) { let best = 0; for (const k in cmpCount) if (cmpCount[k] > best) { best = cmpCount[k]; cmpVar = k; } }
  cmpVar = cmpVar || opVar;

  let nSwitch = 0, nIf = 0;
  const seen = new Set();
  // switch 收集：discriminant 含 cmpVar，或**直接读字节码**（含 srcArr+pcVar）——后者处理 `switch(code[pc++])`
  //   这种**无中间变量**的纯 switch；两者都自动跳过平坦化假外壳 `switch(state)`（state 既非 cmpVar、也不读字节码）。
  walk(body, n => {
    if (n.type !== 'SwitchStatement') return;
    const d = n.discriminant;
    const isDispatch = (cmpVar && usesVar(d, cmpVar)) || (usesVar(d, srcArr) && usesVar(d, pcVar));
    if (!isDispatch) return;
    for (const c of n.cases) if (c.test) { const k = litKey(c.test); if (k != null && !seen.has(k)) { seen.add(k); handlers[k] = { op: k, start: c.start, end: c.end, line: lineOf(c.start), snippet: snippet(c) }; nSwitch++; } }
  });
  // if 等值收集：必须有明确 cmpVar（否则 cmpVar=null 会把所有 identifier===literal 乱收）
  if (cmpVar) {
    walk(body, n => {
      if (n.type !== 'IfStatement') return;
      // 等值：cmpVar===lit / lit===cmpVar / (||多值共用同一 handler) → 该 if 的 consequent = handler
      const eqs = collectEqs(n.test, cmpVar);
      for (const k of eqs) if (!seen.has(k)) { seen.add(k); handlers[k] = { op: k, start: n.consequent.start, end: n.consequent.end, line: lineOf(n.consequent.start), snippet: snippet(n.consequent) }; nIf++; }
      // 范围/分组：cmpVar </<=/>/>= lit（含 && 双界）→ 标注分组、不计 op；内层细分由 walk 递归继续收。
      if (eqs.length === 0) { const rg = rangeOf(n.test, cmpVar); if (rg) rangeGroups.push({ range: rg, line: lineOf(n.start) }); }
    });
  }
  const opN = Object.keys(handlers).length;
  if (opN > 0) {
    structure = (nSwitch > 0 && nIf > 0) ? 'switch+if-else' : (nSwitch > 0 ? 'switch' : 'if-else');
    if (rangeGroups.length) structure += '+groups';
  } else {
    // 跳转表：H[op](...) / H[op].call/apply(...)，op 含 cmpVar/pcVar。无法静态枚举 op→标注表名。
    let jt = null;
    walk(body, n => {
      if (jt || n.type !== 'CallExpression') return;
      let callee = n.callee;
      if (callee.type === 'MemberExpression' && callee.property && (callee.property.name === 'call' || callee.property.name === 'apply')) callee = callee.object;
      if (callee && callee.type === 'MemberExpression' && callee.computed && usesVar(callee.property, cmpVar || pcVar)) jt = callee;
    });
    if (jt) { structure = 'jump-table'; jumpTable = { table: jt.object.type === 'Identifier' ? jt.object.name : src.slice(jt.object.start, jt.object.end), index: cmpVar || pcVar }; }
  }

  if (structure) score += 2;
  return { score, structure, loop, pcVar, opVar: cmpVar || opVar, srcArr, readNode, handlers, jumpTable, rangeGroups };
}
function cmpVarOf(test) {
  if (test.type === 'BinaryExpression' && (test.operator === '===' || test.operator === '==')) {
    if (test.left.type === 'Identifier' && litKey(test.right) != null) return test.left;
    if (test.right.type === 'Identifier' && litKey(test.left) != null) return test.right;
  }
  return null;
}
function eqLiteral(test, cmpVar) {
  if (test.type !== 'BinaryExpression' || (test.operator !== '===' && test.operator !== '==')) return null;
  const { left, right } = test;
  const isV = n => n.type === 'Identifier' && (cmpVar ? n.name === cmpVar : true);
  if (litKey(right) != null && isV(left)) return litKey(right); // op === 0x3b
  if (litKey(left) != null && isV(right)) return litKey(left); // 0x3b === op
  return null;
}
// 一个 test 里所有「<某变量> === <字面量>」的变量名（用来统计谁最像 opVar）。walk 递归 → 进 ||、嵌套。
function cmpVarsOf(test) {
  const out = [];
  walk(test, n => {
    if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==')) {
      if (n.left.type === 'Identifier' && litKey(n.right) != null) out.push(n.left.name);
      else if (n.right.type === 'Identifier' && litKey(n.left) != null) out.push(n.right.name);
    }
  });
  return out;
}
// 一个 test 里所有「cmpVar === 字面量」的字面量（支持 `op===A||op===B` 多值共用同一 handler）。
function collectEqs(test, cmpVar) {
  const out = [];
  walk(test, n => { if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==')) { const k = eqLiteral(n, cmpVar); if (k != null) out.push(k); } });
  return out;
}
// 范围/分组比较：cmpVar </<=/>/>= 字面量（含 && 双界）→ 返回描述串；这类是「分组选择」不是单个 opcode。
function rangeOf(test, cmpVar) {
  const parts = [];
  walk(test, n => {
    if (n.type === 'BinaryExpression' && /^(<|<=|>|>=)$/.test(n.operator)) {
      if (n.left.type === 'Identifier' && n.left.name === cmpVar && litKey(n.right) != null) parts.push(cmpVar + n.operator + litKey(n.right));
      else if (n.right.type === 'Identifier' && n.right.name === cmpVar && litKey(n.left) != null) parts.push(litKey(n.left) + n.operator + cmpVar);
    }
  });
  return parts.length ? parts.join(' && ') : null;
}

const scored = loops.map(analyze).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
const candidates = scored.map(r => ({ line: lineOf(r.loop.start), score: r.score, structure: r.structure || 'unknown', pcVar: r.pcVar, opVar: r.opVar, srcArr: r.srcArr, ops: r.handlers ? Object.keys(r.handlers).length : 0 }));

if (!scored.length) {
  emit({ ok: true, found: false, candidates, diagnostics: '未定位到符合 JSVMP 特征的派发循环（没有「循环 + PC 自增 + 按 PC 取字节码 + 取值驱动分支」的组合）。确认传入的是 dispatcher 函数本体、且没被截断（用 page_eval saveTo 取全）。' });
}
const top = scored[0];
const opCount = Object.keys(top.handlers || {}).length;
emit({
  ok: true,
  found: true,
  structure: top.structure || 'unknown',
  dispatchLoop: { line: lineOf(top.loop.start), start: top.loop.start, end: top.loop.end },
  decode: { pcVar: top.pcVar, opVar: top.opVar, bytecodeVar: top.srcArr, readExpr: top.readNode ? snippet(top.readNode, 80) : null },
  handlers: top.handlers || {},
  rangeGroups: top.rangeGroups || [],
  jumpTable: top.jumpTable || null,
  candidates,
  diagnostics:
    opCount > 0
      ? `派发循环在第 ${lineOf(top.loop.start)} 行，结构=${top.structure}，**全范围**抽出 ${opCount} 个 opcode→handler` +
        (top.rangeGroups && top.rangeGroups.length ? `（另标注 ${top.rangeGroups.length} 个范围/分组比较，其内层细分 op 也已收）` : '') + '。' +
        (/if-else/.test(top.structure) ? '（老 split_dispatcher 不认 if-else，已由 probe 补上。）' : '')
      : top.structure === 'jump-table'
        ? `派发循环在第 ${lineOf(top.loop.start)} 行，结构=跳转表（handler 在「${top.jumpTable && top.jumpTable.table}」里、op 作下标）。具体 op→handler 无法纯静态枚举：page_eval/run_node 读那个数组成员，或对字节码动态 trace。`
        : `定位到疑似派发循环在第 ${lineOf(top.loop.start)} 行（pcVar=${top.pcVar}, bytecodeVar=${top.srcArr}），但没抽出 opcode→handler；结构可能是变体，附循环体片段供人工判断。`,
});
