/**
 * Fix 3 [P1] — WGSL cost estimate (texture sample count, instruction estimate,
 * control-flow complexity, costScore).
 */

import { describe, expect, it } from 'vitest';
import { extractShaderCostEstimate } from '@modules/webgpu/WgslParser';

describe('extractShaderCostEstimate — WGSL instruction cost analysis', () => {
  it('counts texture sampling calls', () => {
    const shader = `
@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let t1 = textureSample(tex, samp, uv);
  let t2 = textureSampleLevel(tex, samp, uv, 0.0);
  let t3 = textureGather(0, tex, samp, uv);
  let t4 = textureLoad(tex, vec2<i32>(0, 0));
  return t1 + t2 + t3 + t4;
}`;
    const est = extractShaderCostEstimate(shader);
    expect(est.textureSamples).toBe(4);
  });

  it('does not count comments as instructions or samples', () => {
    const shader = `
// textureSample(comment only)
/* textureSampleLevel(block comment) */
@compute @workgroup_size(8)
fn cs() {
  let x = 1; // textureSample(also comment)
}`;
    const est = extractShaderCostEstimate(shader);
    expect(est.textureSamples).toBe(0);
  });

  it('estimates instruction count from statements and control flow', () => {
    const shader = `
@fragment
fn fs() -> @location(0) vec4<f32> {
  var acc = vec4<f32>(0.0);
  for (var i = 0u; i < 8u; i++) {
    acc += vec4<f32>(f32(i));
  }
  if (acc.x > 0.0) {
    return acc;
  } else {
    return vec4<f32>(1.0);
  }
}`;
    const est = extractShaderCostEstimate(shader);
    expect(est.totalInstructions).toBeGreaterThan(0);
    // for + if + else = control flow
    expect(est.controlFlowComplexity).toBeGreaterThanOrEqual(3);
  });

  it('scores texture samples highest in costScore', () => {
    const sampler = `
@fragment
fn fs() -> @location(0) vec4<f32> {
  let t = textureSample(tex, samp, vec2<f32>(0.5));
  return t;
}`;
    const plain = `
@fragment
fn fs() -> @location(0) vec4<f32> {
  let t = vec4<f32>(1.0);
  return t;
}`;
    const samplerEst = extractShaderCostEstimate(sampler);
    const plainEst = extractShaderCostEstimate(plain);
    expect(samplerEst.costScore).toBeGreaterThan(plainEst.costScore);
  });

  it('preserves code after line-comment pattern inside a string literal', () => {
    // When stripComments is not string-aware, the "//" inside the string
    // eats the rest of the line — including textureSample on the same line.
    const shader = `
@fragment
fn fs() -> @location(0) vec4<f32> {
  let msg = "// drops"; let x = textureSample(tex, samp, uv);
  return vec4<f32>(0.0);
}`;
    const est = extractShaderCostEstimate(shader);
    // textureSample is on the same line after "//" inside a string literal.
    // A naive stripComments would treat "// drops"..." as a line comment
    // and lose the textureSample call. The fix must track string state.
    expect(est.textureSamples).toBe(1);
  });

  it('preserves code after block-comment pattern inside a string literal', () => {
    // When stripComments is not string-aware, the "/*" inside a string starts
    // a block comment that spans across the real "*/" — swallowing
    // textureSample in between.
    const shader = `
@fragment
fn fs() -> @location(0) vec4<f32> {
  let a = "/* open";
  let b = textureSample(tex, samp, uv);
  /* real close */
  return vec4<f32>(0.0);
}`;
    const est = extractShaderCostEstimate(shader);
    // textureSample between "/* open" (in a string) and "/* real close */"
    // (real comment) is code — not part of any comment.
    expect(est.textureSamples).toBe(1);
  });

  it('handles empty / trivial input without throwing', () => {
    const est = extractShaderCostEstimate('');
    expect(est.totalInstructions).toBe(0);
    expect(est.textureSamples).toBe(0);
    expect(est.controlFlowComplexity).toBe(0);
    expect(est.costScore).toBe(0);
  });
});
