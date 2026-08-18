// sign-source.js — paste the EXTRACTED signing function + its closure deps.
//
// Required: end of file MUST expose entry:
//   window.__sign__ = function (input) { ... return { headers, body }; };
//
// Tips for extraction (Phase 2 → Phase 4 Step 1):
//   1. set_breakpoint_on_text on the actual axios interceptor (NOT
//      window.fetch — see rule 23)
//   2. step-out to find the sign(...) call site
//   3. copy the WHOLE webpack module containing sign + any helpers it
//      closes over (string-decrypt arrays, _0x* refs, anti-debugger guards)
//   4. wrap the IIFE: (function(){ ... window.__sign__ = sign; })();

(function () {
  // -- paste extracted signer here ----------------------------------------

  function __sign__(input) {
    // placeholder
    return { headers: { 'x-sign': 'TODO', 'x-ts': String(Date.now()) } };
  }

  window.__sign__ = __sign__;
})();
