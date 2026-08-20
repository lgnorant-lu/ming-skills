import type { JSVMPDeobfuscatorResult, VMInstruction } from '@internal-types/index';

const VM_DISPATCH_PATTERNS = [
  { type: 'for-switch', test: /for.*switch/s },
  { type: 'while-switch', test: /while.*switch/s },
  { type: 'if-else-chain', test: /if\s*\(\s*\w+\s*===?\s*\w+/ },
] as const;

function detectVmDispatchType(code: string): string {
  for (const pattern of VM_DISPATCH_PATTERNS) {
    if (pattern.test.test(code)) {
      return pattern.type;
    }
  }

  return 'switch';
}

function buildOpcodeDistribution(instructions: VMInstruction[]): Record<string, number> {
  const distribution = new Map<string, number>();

  for (const instruction of instructions) {
    const type = instruction.type || 'unknown';
    distribution.set(type, (distribution.get(type) || 0) + 1);
  }

  return Object.fromEntries(distribution);
}

export function buildVmAnalysisResponse(options: {
  code: string;
  extractBytecode: boolean;
  mapOpcodes: boolean;
  vmResult: JSVMPDeobfuscatorResult;
}): Record<string, unknown> {
  const { code, extractBytecode, mapOpcodes, vmResult } = options;

  if (!vmResult.isJSVMP) {
    return {
      success: true,
      isVM: false,
      message: 'No VM/JSVMP patterns detected.',
    };
  }

  const analysis: Record<string, unknown> = {
    isVM: true,
    vmType: vmResult.vmType,
    dispatchType: detectVmDispatchType(code),
    complexity: vmResult.vmFeatures?.complexity,
    instructionCount: vmResult.vmFeatures?.instructionCount,
    interpreterLocation: vmResult.vmFeatures?.interpreterLocation,
  };

  if (extractBytecode && vmResult.instructions) {
    analysis.bytecode = vmResult.instructions;
  }

  if (mapOpcodes && vmResult.instructions) {
    analysis.opcodeDistribution = buildOpcodeDistribution(vmResult.instructions);
    analysis.suggestedStrategy =
      vmResult.vmFeatures?.complexity === 'high'
        ? 'Use js_symbolic_execute_jsvmp with these instructions for high-complexity VMs'
        : 'Use standard deobfuscation pipeline (js_deobfuscate_pipeline)';
  }

  return {
    success: true,
    analysis,
  };
}
