export function buildHookCode(
  name: string,
  body: string,
  captureStack: boolean,
  logToConsole: boolean,
  mutateReturn?: string,
): string {
  const stackCode = captureStack
    ? `const __stack = new Error().stack?.split('\\n').slice(1,4).join(' | ') || '';`
    : `const __stack = '';`;
  const logFn = logToConsole ? `console.log(__msg + (__stack ? ' | Stack: ' + __stack : ''));` : ``;
  // When a mutateReturn expression is supplied, expose a __mutateReturn(result)
  // helper inside the IIFE. Preset bodies opt in by wrapping the original call's
  // return value, e.g. `return __mutateReturn(_orig.call(this, code));`. The
  // expression may reference __result (the wrapped value). Opt-in only — when
  // omitted, the generated code is byte-identical to before (back-compatible).
  const mutateFn = mutateReturn
    ? `const __mutateReturn = function(__result) { return (${mutateReturn}); };`
    : ``;
  return `
(function() {
  if (window.__hookPresets === undefined) window.__hookPresets = {};
  if (window.__hookPresets['${name}']) return;
  ${mutateFn}
  ${body.replace(/\{\{STACK_CODE\}\}/g, stackCode).replace(/\{\{LOG_FN\}\}/g, logFn)}
  window.__hookPresets['${name}'] = true;
  window.__aiHooks = window.__aiHooks || {};
  window.__aiHooks['preset-${name}'] = window.__aiHooks['preset-${name}'] || [];
})();`;
}

export type PresetEntry = {
  description: string;
  buildCode: (captureStack: boolean, logToConsole: boolean) => string;
};
