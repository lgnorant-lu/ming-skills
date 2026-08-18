// runner.js — load sign source under vm + stub, expose sign() to CLI.
//
// Usage:
//   node runner.js                       → sign sample[0] from config/samples.json
//   node runner.js '{"path":"/api/x"}'   → sign arbitrary JSON input
//
// Phase 4 Step 3 (SKILL.md rule 34): runner output must match browser-capture
// byte-for-byte before you may move on.

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const env    = require('./stub.js');
const SIGN_SRC = fs.readFileSync(path.join(__dirname, 'config', 'sign-source.js'), 'utf8');

const sandbox = Object.assign(
  {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Buffer,                                   // sometimes needed for binary maths
    require,                                  // ← REMOVE before publishing; keep for debug
  },
  env,                                        // window/navigator/document/location
  { global: undefined, process: undefined },  // hide Node identity
);

vm.createContext(sandbox);
vm.runInContext(SIGN_SRC, sandbox, { filename: 'sign-source.js', timeout: 5000 });

// The signer source MUST end with one of:
//   window.__sign__ = function(input) { ... return {headers}; };
//   globalThis.__sign__ = ...
// so we have a clean entrypoint.
const signer = sandbox.window.__sign__ || sandbox.__sign__;
if (typeof signer !== 'function') {
  console.error('[runner] sign-source.js did not expose window.__sign__(input)');
  process.exit(2);
}

function sign(input) { return signer(input); }
module.exports = { sign };

if (require.main === module) {
  let input;
  if (process.argv[2]) {
    input = JSON.parse(process.argv[2]);
  } else {
    const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'samples.json'), 'utf8'));
    input = samples[0].input;
  }
  const out = sign(input);
  console.log(JSON.stringify(out, null, 2));
}
