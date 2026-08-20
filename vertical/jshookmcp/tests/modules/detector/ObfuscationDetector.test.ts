import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/modules/deobfuscator/JSVMPDeobfuscator', () => {
  return {
    JSVMPDeobfuscator: class {
      detectJSVMP(code: string) {
        if (code.includes('vmhit')) {
          return {
            instructionCount: 64,
            interpreterLocation: 'line:10',
            complexity: 'high',
            hasSwitch: true,
            hasInstructionArray: true,
            hasProgramCounter: true,
          };
        }
        throw new Error('not-vm');
      }
    },
  };
});

import { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';

describe('ObfuscationDetector', () => {
  it('returns unknown for clean code', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('const answer = 42;');

    expect(result.types).toEqual(['unknown']);
    expect(result.confidence.unknown).toBe(0.5);
    expect(result.classifier).toEqual(
      expect.objectContaining({
        name: 'generic',
        confidence: 0.5,
      }),
    );
  });

  it('detects webpack obfuscation pattern', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('function x(){ return __webpack_require__(1); }');
    expect(result.types).toContain('webpack');
  });

  it('detects JSFuck payload', () => {
    const detector = new ObfuscationDetector();
    const jsfuck = '[](!+[]+!![])[+!![]]';
    const result = detector.detect(jsfuck);
    expect(result.types).toContain('jsfuck');
    expect(result.classifier.name).toBe('jsfuck');
  });

  it('uses direct VM detection result when available', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('vmhit');

    expect(result.types).toContain('vm-protection');
    expect(result.vmFeatures?.instructionCount).toBe(64);
    expect(result.features.some((f) => f.includes('JSVMP'))).toBe(true);
  });

  it('detects WASM-VM obfuscation (WebAssembly + embedded magic bytes)', () => {
    const detector = new ObfuscationDetector();
    const wasmVmCode = `
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,60,3,127,0,0]);
      WebAssembly.instantiate(bytes).then(({instance}) => instance.exports.main());
    `;
    const result = detector.detect(wasmVmCode);
    expect(result.types).toContain('wasm-vm');
    expect(result.features.some((f) => f.includes('WebAssembly VM'))).toBe(true);
  });

  it('does not flag clean WebAssembly.instantiate without embedded bytecode', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('const m = await WebAssembly.instantiate(blob);');
    expect(result.types).not.toContain('wasm-vm');
  });

  it('falls back to heuristic VM detection when parser throws', () => {
    const detector = new ObfuscationDetector();
    const heuristicVmCode = `
      while (true) {
        switch (state) {
          case 0: state = vm[pc++]; break;
        }
      }
      var vm = [1,2,3,4,5,6,7,8,9,10,11,12];
    `;
    const result = detector.detect(heuristicVmCode);

    expect(result.types).toContain('vm-protection');
    expect(result.vmFeatures?.interpreterLocation).toBe('Unknown');
  });

  it('generateReport includes types, features and recommendations', () => {
    const detector = new ObfuscationDetector();
    const detected = detector.detect('eval(function(p,a,c,k,e,d){})');
    const report = detector.generateReport(detected);

    expect(report).toContain('Obfuscation Detection Report');
    expect(report).toContain('Classifier');
    expect(report).toContain('Detected Types');
    expect(report).toContain('Recommendations');
  });

  it('classifies javascript-obfuscator and obfuscator.io branding through existing heuristics', () => {
    const detector = new ObfuscationDetector();
    const code = `
      /* obfuscator.io */
      var _0x12ab = ['alpha', 'beta'];
      (function(_0x12ab, _0x77ff) { return _0x12ab[_0x77ff]; })(_0x12ab, 0);
      while (!![]) { break; }
    `;

    const result = detector.detect(code);

    expect(result.types).toContain('javascript-obfuscator');
    expect(result.classifier).toEqual(
      expect.objectContaining({
        name: 'obfuscator.io',
        confidence: 0.9,
      }),
    );
  });

  it('detects remaining signature families and recommends runtime hooks when needed', () => {
    const detector = new ObfuscationDetector();
    const runtimeCode = `
      eval("a");
      eval("b");
      eval("c");
      const factory = new Function("return 1");
      const hidden = "zero\u200Bwidth";
      const encoded = "%41%42%43%44%45%46%47%48%49%4A%4B";
      const packed = eval(function(p,a,c,k,e,d){return p;});
      const aa = "゚ω゚";
      const jj = "$={___:++$";
    `;

    const result = detector.detect(runtimeCode);

    expect(result.types).toEqual(
      expect.arrayContaining([
        'invisible-unicode',
        'eval-obfuscation',
        'self-modifying',
        'packer',
        'aaencode',
        'jjencode',
        'urlencoded',
      ]),
    );
    expect(result.toolRecommendations.some((item) => item.tool === 'ai_hook')).toBe(true);
    expect(result.toolRecommendations.some((item) => item.tool === 'deobfuscate')).toBe(true);
  });

  it('accumulates JScrambler heuristics from multiple indicators', () => {
    const detector = new ObfuscationDetector();
    const code = `
      while (!![]) {
        switch (state) {
          case 0:
            debugger;
            constructor;
            function demo(x) { return x.charCodeAt(0).fromCharCode(0); }
            Function.prototype.toString.call(demo);
            break;
        }
      }
    `;

    const result = detector.detect(code);

    expect(result.types).toContain('jscrambler');
    expect(result.features).toContain('Control flow flattening + Self-defending');
    expect(result.recommendations).toContain('Use JScrambler deobfuscator');
  });
});
