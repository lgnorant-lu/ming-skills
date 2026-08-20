#!/usr/bin/env node
// One-shot 6-dimension domain audit scanner. Produces objective metrics per
// domain so the handoff can plan concrete tasks. Output: scripts/domain-audit.json
//
// Dimensions:
//   D1 tool count
//   D2 test files (rough proxy for coverage)
//   D3 coverage-excluded files (from vitest.config.ts)
//   D4 bare `catch {}` count (error-handling honesty)
//   D5 handleSafe coverage (handlers using handleSafe / total handlers)
//   D6 doc completeness (CLAUDE.md exists? Audit Score? prerequisites? toolDependencies?)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DOMAIN_DIR = 'src/server/domains';
const OUTPUT_PATH = 'scripts/domain-audit.json';
const domains = fs.readdirSync(DOMAIN_DIR).filter((d) => {
  const dir = path.join(DOMAIN_DIR, d);
  const hasManifest =
    fs.existsSync(path.join(dir, 'manifest.ts')) || fs.existsSync(path.join(dir, 'manifest.js'));
  const hasLegacyToolSurface =
    fs.existsSync(path.join(dir, 'definitions.ts')) && fs.existsSync(path.join(dir, 'index.ts'));
  return hasManifest || hasLegacyToolSurface;
});

const vitestConfig = fs.readFileSync('vitest.config.ts', 'utf8');

// Node-native recursive walk — `find` is unreliable on Windows.
function listTs(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function countTestFiles(domain) {
  const roots = [`tests/server/domains/${domain}`, `tests/modules/${domain}`];
  let n = 0;
  for (const r of roots) {
    if (fs.existsSync(r)) {
      n += listTs(r).filter((f) => f.endsWith('.test.ts')).length;
    }
  }
  // Also count any test file anywhere whose path contains the domain name
  // (some domains like exploit-dev live under tests/server/domains/exploit-dev/).
  return n;
}

function countMatches(content, pattern) {
  return (content.match(pattern) || []).length;
}

function isDefinitionScope(file) {
  const normalized = file.split(path.sep).join('/');
  return (
    path.basename(file) === 'definitions.ts' ||
    normalized.includes('/definitions/') ||
    normalized.endsWith('/definitions/index.ts')
  );
}

function countToolDefinitions(files) {
  let n = 0;
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');

    // Tool definitions use several local styles:
    // - registry builder: tool('name', ...)
    // - BoringSSL object wrapper: objectTool('name', ...)
    // - raw MCP Tool objects in definitions files: { name: 'name', ... }
    n += countMatches(content, /\btool\(\s*['"`]/g);
    n += countMatches(content, /\bobjectTool\(\s*['"`]/g);
    if (isDefinitionScope(f)) {
      n += countMatches(content, /\bname\s*:\s*['"`][a-zA-Z0-9_.:-]+['"`]/g);
    }
  }
  return n;
}

function formatGeneratedJson(file) {
  const result = spawnSync('pnpm', ['exec', 'oxfmt', file], { shell: true, stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.warn(`[audit] warning: generated ${file}, but oxfmt formatting was unavailable`);
  }
}

const audit = {};

for (const domain of domains.toSorted()) {
  const dir = path.join(DOMAIN_DIR, domain);
  const entry = { domain, dims: {} };

  // D1 tool count — count supported definition styles across domain source.
  const srcTsFiles = listTs(dir);
  entry.dims.d1_toolCount = countToolDefinitions(srcTsFiles);

  // D2 test files
  entry.dims.d2_testFiles = countTestFiles(domain);

  // D3 coverage-excluded files for this domain
  const excludeRe = new RegExp(`src/server/domains/${domain}/[^'"]+`, 'g');
  const excluded = vitestConfig.match(excludeRe) || [];
  entry.dims.d3_coverageExcluded = [...new Set(excluded)];

  // D4 bare `catch {}` count across domain source.
  // Matches: `catch {`, `catch(e){` is NOT bare. Bare = no binding or empty binding.
  let bareCatch = 0;
  for (const f of srcTsFiles) {
    const c = fs.readFileSync(f, 'utf8');
    // `catch {` (no parens) or `catch ( ) {` (empty parens) — both swallow the error.
    bareCatch += (c.match(/\bcatch\s*\(\s*\)\s*\{/g) || []).length;
    bareCatch += (c.match(/\bcatch\s*\{/g) || []).length;
  }
  entry.dims.d4_bareCatch = bareCatch;

  // D5 handleSafe references
  let handleSafeCount = 0;
  for (const f of srcTsFiles) {
    const c = fs.readFileSync(f, 'utf8');
    handleSafeCount += (c.match(/\bhandleSafe\b/g) || []).length;
  }
  entry.dims.d5_handleSafeRefs = handleSafeCount;

  // D6 doc completeness
  const claudePath = path.join(dir, 'CLAUDE.md');
  const doc = { hasClaude: false, hasScore: false, hasPrereq: false, hasToolDeps: false };
  if (fs.existsSync(claudePath)) {
    const c = fs.readFileSync(claudePath, 'utf8');
    doc.hasClaude = true;
    doc.hasScore = /Audit Score/i.test(c);
    doc.hasPrereq = /## Prerequisites|## Prerequisite/i.test(c);
    doc.hasToolDeps = /## Tool Dependencies/i.test(c);
  }
  entry.dims.d6_doc = doc;

  audit[domain] = entry;
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(audit, null, 2) + '\n');
formatGeneratedJson(OUTPUT_PATH);
console.log(`Audited ${domains.length} domains → ${OUTPUT_PATH}`);
for (const [d, e] of Object.entries(audit)) {
  const doc = e.dims.d6_doc;
  console.log(
    `${d.padEnd(22)} tools=${String(e.dims.d1_toolCount).padStart(3)} tests=${String(e.dims.d2_testFiles).padStart(3)} ` +
      `catch=${String(e.dims.d4_bareCatch).padStart(3)} hs=${String(e.dims.d5_handleSafeRefs).padStart(3)} ` +
      `exc=${String(e.dims.d3_coverageExcluded.length).padStart(2)} ` +
      `doc=${doc.hasClaude ? 'C' : '-'}${doc.hasScore ? 'S' : '-'}${doc.hasPrereq ? 'P' : '-'}${doc.hasToolDeps ? 'D' : '-'}`,
  );
}
