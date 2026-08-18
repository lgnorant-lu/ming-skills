// env_diff.js — what's missing in stub.js that the browser provides.
//
// Run the SAME probe (see hooks/runtime_probe.js or the env_diff_snippet MCP
// tool) in BOTH the browser console AND here. Diff the two JSON blobs to
// know which navigator/document/window keys the signer accessed but our
// stub doesn't define.

'use strict';

const fs    = require('fs');
const path  = require('path');
const env   = require('./stub.js');

const browserDump = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'browser-env.json'), 'utf8'));

function shallowKeys(o, prefix) {
  if (!o || typeof o !== 'object') return [];
  return Object.keys(o).map(k => prefix ? `${prefix}.${k}` : k);
}

const nodeKeys = new Set([
  ...shallowKeys(env.navigator, 'navigator'),
  ...shallowKeys(env.document,  'document'),
  ...shallowKeys(env.location,  'location'),
  ...shallowKeys(env.window,    'window'),
]);
const browserKeys = new Set([
  ...shallowKeys(browserDump.navigator, 'navigator'),
  ...shallowKeys(browserDump.document,  'document'),
  ...shallowKeys(browserDump.location,  'location'),
  ...shallowKeys(browserDump.window,    'window'),
]);

const missing = [...browserKeys].filter(k => !nodeKeys.has(k));
const extra   = [...nodeKeys].filter(k => !browserKeys.has(k));

console.log(JSON.stringify({
  missing_in_stub: missing,
  extra_in_stub:   extra,
  hint: 'add only those keys from missing_in_stub that signer actually reads (see env_patch_minimize)',
}, null, 2));
