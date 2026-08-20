import type { RetryPolicy } from '@server/workflows/WorkflowContract';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

const DEFAULT_SESSION_ID = 'default';
const MAX_POLICY_SCOPES = 256;
const retryPolicies = new Map<string, RetryPolicy>();

function policyScope(sessionId?: string | null): string {
  const resolved = sessionId ?? getToolRequestContext()?.sessionId;
  return typeof resolved === 'string' && resolved.trim().length > 0
    ? resolved.trim()
    : DEFAULT_SESSION_ID;
}

export function getGlobalRetryPolicy(): RetryPolicy | undefined {
  const policy = retryPolicies.get(policyScope());
  return policy ? { ...policy } : undefined;
}

export function setGlobalRetryPolicy(policy: RetryPolicy): void {
  const scope = policyScope();
  if (!retryPolicies.has(scope) && retryPolicies.size >= MAX_POLICY_SCOPES) {
    const oldest = retryPolicies.keys().next().value as string | undefined;
    if (oldest) retryPolicies.delete(oldest);
  }
  retryPolicies.set(scope, { ...policy });
}

export function clearSessionRetryPolicy(sessionId: string): void {
  retryPolicies.delete(policyScope(sessionId));
}
