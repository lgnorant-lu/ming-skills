// verify.js — byte-for-byte compare sign(sample.input) vs sample.expected
//
// Reads config/samples.json:
//   [ { "id": "...", "input": {...}, "expected": {...} }, ... ]
//
// Each sample.expected is the EXACT object the browser produced (capture from
// Network panel). Failure mode is character-level first-divergence so you
// don't waste an hour staring at two 200-char strings.

'use strict';

const fs = require('fs');
const path = require('path');
const { sign } = require('./runner.js');

const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'samples.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];

for (const s of samples) {
  let actual, err;
  try { actual = sign(s.input); } catch (e) { err = e; }

  const a = JSON.stringify(actual);
  const e = JSON.stringify(s.expected);

  if (err) {
    fail++;
    failures.push({ id: s.id, kind: 'exception', message: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join('\n') });
    continue;
  }

  if (a === e) { pass++; continue; }

  // first-divergence locator
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) i++;
  const ctx = 30;
  fail++;
  failures.push({
    id: s.id,
    first_divergence_at: i,
    actual_around:   a.slice(Math.max(0, i - ctx), i + ctx),
    expected_around: e.slice(Math.max(0, i - ctx), i + ctx),
    actual_len: a.length,
    expected_len: e.length,
  });
}

console.log(`\n=== verify: ${pass}/${pass + fail} pass ===\n`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
