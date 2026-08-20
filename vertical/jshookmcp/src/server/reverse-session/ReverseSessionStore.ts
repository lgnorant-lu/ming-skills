import { randomUUID } from 'node:crypto';
import type { ReverseSessionRecord, ReverseSessionTarget } from './types';

export class ReverseSessionStore {
  private readonly sessions = new Map<string, ReverseSessionRecord>();

  create(input: {
    artifactRoot: string;
    target: ReverseSessionTarget;
    steps: ReverseSessionRecord['steps'];
    evidenceRefs?: string[];
    nextSteps: string[];
  }): ReverseSessionRecord {
    const now = new Date().toISOString();
    const record: ReverseSessionRecord = {
      sessionId: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'planned',
      artifactRoot: input.artifactRoot,
      target: input.target,
      steps: input.steps,
      evidenceRefs: input.evidenceRefs ?? [],
      runs: [],
      nextSteps: input.nextSteps,
    };
    this.sessions.set(record.sessionId, record);
    return record;
  }

  get(sessionId: string): ReverseSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  list(): ReverseSessionRecord[] {
    return [...this.sessions.values()];
  }

  touch(record: ReverseSessionRecord): ReverseSessionRecord {
    record.updatedAt = new Date().toISOString();
    this.sessions.set(record.sessionId, record);
    return record;
  }
}
