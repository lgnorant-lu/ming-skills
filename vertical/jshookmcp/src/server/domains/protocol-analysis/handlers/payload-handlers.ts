/**
 * ProtocolAnalysisPayloadHandlers — payload template and mutation handlers.
 */

import type { ToolArgs } from '@server/types';
import type { PayloadFieldSegment, PayloadMutationSummary } from './shared';
import {
  applyPayloadMutation,
  buildPayloadFromTemplate,
  normalizeHexString,
  parseEndian,
  parsePayloadMutation,
  parsePayloadTemplateField,
} from './shared';
import { ProtocolAnalysisPatternHandlers } from './pattern-handlers';

export class ProtocolAnalysisPayloadHandlers extends ProtocolAnalysisPatternHandlers {
  async handlePayloadTemplateBuild(args: ToolArgs): Promise<{
    hexPayload: string;
    byteLength: number;
    fields: PayloadFieldSegment[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const rawFields = args.fields;
      if (!Array.isArray(rawFields)) {
        throw new Error('fields must be an array');
      }

      const fields = rawFields.map((field, index) => parsePayloadTemplateField(field, index));
      const endian = parseEndian(args.endian);
      const { payload, segments } = buildPayloadFromTemplate(fields, endian);
      this.emitEvent('protocol:payload_built', {
        byteLength: payload.length,
        fieldCount: segments.length,
      });
      return {
        hexPayload: payload.toString('hex'),
        byteLength: payload.length,
        fields: segments,
        success: true,
      };
    } catch (error) {
      return {
        hexPayload: '',
        byteLength: 0,
        fields: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handlePayloadMutate(args: ToolArgs): Promise<{
    originalHex: string;
    mutatedHex: string;
    byteLength: number;
    appliedMutations: PayloadMutationSummary[];
    success?: boolean;
    error?: string;
  }> {
    let originalHex = '';

    try {
      if (typeof args.hexPayload !== 'string') {
        throw new Error('hexPayload must be a string');
      }
      originalHex = normalizeHexString(args.hexPayload, 'hexPayload');

      const rawMutations = args.mutations;
      if (!Array.isArray(rawMutations)) {
        throw new Error('mutations must be an array');
      }

      let payload: Buffer = Buffer.from(originalHex, 'hex');
      const appliedMutations: PayloadMutationSummary[] = [];
      for (const [index, rawMutation] of rawMutations.entries()) {
        const mutation = parsePayloadMutation(rawMutation, index);
        const result = applyPayloadMutation(payload, mutation, index);
        payload = result.payload;
        appliedMutations.push(result.summary);
      }

      this.emitEvent('protocol:payload_mutated', {
        byteLength: payload.length,
        mutationCount: appliedMutations.length,
      });

      return {
        originalHex,
        mutatedHex: payload.toString('hex'),
        byteLength: payload.length,
        appliedMutations,
        success: true,
      };
    } catch (error) {
      return {
        originalHex,
        mutatedHex: '',
        byteLength: 0,
        appliedMutations: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}
