/**
 * ProtocolAnalysisPatternHandlers — pattern inference and state-machine handlers.
 */

import type {
  FieldSpec,
  PatternSpec,
  ProtocolPattern,
  StateMachine,
} from '@modules/protocol-analysis';
import {
  argObject,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import type { ToolArgs } from '@server/types';
import {
  isRecord,
  parseEncryptionInfo,
  parseLegacyField,
  parsePatternSpec,
  parseProtocolMessage,
} from './shared';
import { EMPTY_STATE_MACHINE, ProtocolAnalysisBaseHandlers } from './base';

export class ProtocolAnalysisPatternHandlers extends ProtocolAnalysisBaseHandlers {
  async handleDefinePattern(args: ToolArgs): Promise<{
    patternId: string;
    pattern: ProtocolPattern;
    success?: boolean;
    error?: string;
  }> {
    try {
      const name =
        typeof args.name === 'string' && args.name.trim().length > 0
          ? args.name
          : 'unnamed_pattern';
      const specObject = argObject(args, 'spec');
      if (specObject) {
        const spec = parsePatternSpec(name, specObject);
        this.getEngine().definePattern(name, spec);
        return {
          patternId: name,
          pattern: this.getEngine().getPattern(name) ?? {
            name,
            fields: [],
            byteOrder: 'big',
          },
          success: true,
        };
      }

      const rawFields = Array.isArray(args.fields) ? args.fields : [];
      const fields = rawFields.map((field, index) => parseLegacyField(field, index));
      const byteOrder =
        args.byteOrder === 'little' || args.byteOrder === 'big' ? args.byteOrder : undefined;
      const encryption = parseEncryptionInfo(args.encryption);
      const pattern = this.getEngine().definePattern(name, fields, {
        ...(byteOrder ? { byteOrder } : {}),
        ...(encryption ? { encryption } : {}),
      });

      return { patternId: name, pattern, success: true };
    } catch (error) {
      return {
        patternId: 'error',
        pattern: {
          name: 'error',
          fields: [],
          byteOrder: 'big',
        },
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleAutoDetect(args: ToolArgs): Promise<{
    patterns: ProtocolPattern[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const hexPayloads = (() => {
        const newPayloads = argStringArray(args, 'hexPayloads');
        if (newPayloads.length > 0) {
          return newPayloads;
        }

        return argStringArray(args, 'payloads');
      })();
      const detected = this.getEngine().autoDetect(hexPayloads);
      const patternName =
        typeof args.name === 'string' && args.name.trim().length > 0 ? args.name : undefined;

      if (!detected) {
        const fallback = this.getEngine().autoDetectPattern(
          [],
          patternName ? { name: patternName } : {},
        );
        return { patterns: [fallback], success: true };
      }

      const namedPattern: PatternSpec = {
        ...detected,
        name: patternName ?? detected.name,
      };
      this.getEngine().definePattern(namedPattern.name, namedPattern);
      const result = this.getEngine().getPattern(namedPattern.name) ?? {
        name: namedPattern.name,
        fields: [],
        byteOrder: 'big',
      };
      this.emitEvent('protocol:pattern_detected', {
        patternName: namedPattern.name,
        confidence: 0,
      });
      return {
        patterns: [result],
        success: true,
      };
    } catch (error) {
      return {
        patterns: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleInferFields(
    args: ToolArgs,
  ): Promise<{ fields: FieldSpec[]; success?: boolean; error?: string }> {
    try {
      const hexPayloads = argStringArray(args, 'hexPayloads');
      const fields = this.getEngine().inferFields(hexPayloads);
      return { success: true, fields };
    } catch (error) {
      return {
        fields: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleExportSchema(
    args: ToolArgs,
  ): Promise<{ schema: string; format: 'proto' | 'ksy' | 'json-schema' }> {
    try {
      const patternId = argStringRequired(args, 'patternId');
      const format =
        (argString(args, 'format', 'proto') as 'proto' | 'ksy' | 'json-schema') || 'proto';
      const pattern = this.getEngine().getPattern(patternId);
      if (!pattern) {
        return { schema: `// Error: pattern '${patternId}' not found`, format };
      }

      const engine = this.getEngine();
      let schema: string;
      if (format === 'ksy') schema = engine.exportKsy(pattern);
      else if (format === 'json-schema') schema = engine.exportJsonSchema(pattern);
      else schema = engine.exportProto(pattern);
      return { schema, format };
    } catch (error) {
      return {
        schema: `// Error: ${this.errorMessage(error)}`,
        format: 'proto',
      };
    }
  }

  async handleInferStateMachine(args: ToolArgs): Promise<{
    stateMachine: StateMachine;
    mermaid?: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const rawMessages = args.messages;
      if (!Array.isArray(rawMessages)) {
        throw new Error('messages must be an array');
      }

      const hasLegacyShape = rawMessages.some(
        (message) =>
          isRecord(message) && (message.direction === 'in' || message.direction === 'out'),
      );

      let stateMachine: StateMachine;
      if (hasLegacyShape) {
        const legacyMessages = rawMessages.map((message, index) => {
          if (!isRecord(message)) {
            throw new Error(`messages[${index}] must be an object`);
          }

          const direction = message.direction;
          const payloadHex = typeof message.payloadHex === 'string' ? message.payloadHex : '';
          const timestamp = typeof message.timestamp === 'number' ? message.timestamp : undefined;
          const payload = Buffer.from(payloadHex.replace(/\s+/g, ''), 'hex');

          if (direction !== 'in' && direction !== 'out') {
            throw new Error(`messages[${index}].direction must be "in" or "out"`);
          }

          const legacyDirection: 'in' | 'out' = direction;

          return {
            direction: legacyDirection,
            payload,
            ...(timestamp !== undefined ? { timestamp } : {}),
          };
        });
        stateMachine = this.getInferrer().inferStateMachine(legacyMessages);
      } else {
        const messages = rawMessages.map((message, index) => parseProtocolMessage(message, index));
        stateMachine = this.getInferrer().infer(messages);
      }

      if (args.simplify === true) {
        stateMachine = this.getInferrer().simplify(stateMachine);
      }

      return {
        stateMachine,
        mermaid: this.getInferrer().generateMermaid(stateMachine),
        success: true,
      };
    } catch (error) {
      return {
        stateMachine: { ...EMPTY_STATE_MACHINE },
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleVisualizeState(args: ToolArgs): Promise<{ mermaidDiagram: string }> {
    try {
      const stateMachineValue = args.stateMachine;
      if (!isRecord(stateMachineValue)) {
        return {
          mermaidDiagram: this.getInferrer().generateMermaid(EMPTY_STATE_MACHINE),
        };
      }

      const states = Array.isArray(stateMachineValue.states) ? stateMachineValue.states : [];
      const transitions = Array.isArray(stateMachineValue.transitions)
        ? stateMachineValue.transitions
        : [];
      const initialState =
        typeof stateMachineValue.initialState === 'string' ? stateMachineValue.initialState : '';
      const finalStates = Array.isArray(stateMachineValue.finalStates)
        ? stateMachineValue.finalStates.filter(
            (state): state is string => typeof state === 'string',
          )
        : [];

      return {
        mermaidDiagram: this.getInferrer().generateMermaid({
          states: states.filter((state): state is StateMachine['states'][number] =>
            isRecord(state),
          ),
          transitions: transitions.filter(
            (transition): transition is StateMachine['transitions'][number] => isRecord(transition),
          ),
          initial: initialState,
          initialState,
          finalStates,
        }),
      };
    } catch (error) {
      return {
        mermaidDiagram: `stateDiagram-v2\n  note right of empty: ${this.errorMessage(error)}`,
      };
    }
  }
}
