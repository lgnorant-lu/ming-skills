import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import type { NetworkMonitor } from '@modules/monitor/NetworkMonitor';

export interface BrowserTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  openerId?: string;
  canAccessOpener?: boolean;
  openerFrameId?: string;
  browserContextId?: string;
  subtype?: string;
}

export interface TargetFilters {
  type?: string;
  types?: string[];
  targetId?: string;
  urlPattern?: string;
  titlePattern?: string;
  attachedOnly?: boolean;
  discoverOOPIF?: boolean;
}

export interface ManagedTargetSessionEntry {
  sessionId: string;
  session: CDPSessionLike;
  targetInfo: BrowserTargetInfo;
  networkMonitor: NetworkMonitor | null;
  managedByAutoAttach: boolean;
  appliedPersistentScripts: Map<string, string>;
}

export interface PersistentScriptEntry {
  id: string;
  source: string;
  targetTypes?: string[];
}

interface AttachedToTargetPayload {
  sessionId?: unknown;
  targetInfo?: unknown;
}

interface DetachedFromTargetPayload {
  sessionId?: unknown;
}

interface TargetInfoChangedPayload {
  targetInfo?: unknown;
}

export const AUTO_MANAGED_TARGET_TYPES = new Set(['page', 'iframe']);
export const DEFAULT_PRELOAD_TARGET_TYPES = ['page', 'iframe'];
export const DEFAULT_MANAGED_SCRIPT_PREFIX = 'managed-script';
export const CHILD_SESSION_LOOKUP_RETRIES = 5;
export const CHILD_SESSION_LOOKUP_DELAY_MS = 25;

export function matchesManagedTargetTypes(type: string, targetTypes?: string[]): boolean {
  if (!targetTypes || targetTypes.length === 0) {
    return AUTO_MANAGED_TARGET_TYPES.has(type);
  }
  return targetTypes.includes(type);
}

export function matchesPersistentScriptTarget(
  targetInfo: BrowserTargetInfo,
  script: PersistentScriptEntry,
): boolean {
  return matchesManagedTargetTypes(targetInfo.type, script.targetTypes);
}

export function matchesTargetFilters(target: BrowserTargetInfo, filters: TargetFilters): boolean {
  if (filters.type && target.type !== filters.type) {
    return false;
  }

  if (filters.types?.length && !filters.types.includes(target.type)) {
    return false;
  }

  if (filters.targetId && target.targetId !== filters.targetId) {
    return false;
  }

  if (filters.attachedOnly && !target.attached) {
    return false;
  }

  if (filters.urlPattern && !target.url.includes(filters.urlPattern)) {
    return false;
  }

  if (filters.titlePattern && !target.title.includes(filters.titlePattern)) {
    return false;
  }

  return true;
}

export function normalizeBrowserTargetInfo(
  target: Record<string, unknown>,
): BrowserTargetInfo | null {
  const targetId = typeof target.targetId === 'string' ? target.targetId : null;
  const type = typeof target.type === 'string' ? target.type : null;
  const title = typeof target.title === 'string' ? target.title : '';
  const url = typeof target.url === 'string' ? target.url : '';

  if (!targetId || !type) {
    return null;
  }

  return {
    targetId,
    type,
    title,
    url,
    attached: Boolean(target.attached),
    openerId: typeof target.openerId === 'string' ? target.openerId : undefined,
    canAccessOpener:
      typeof target.canAccessOpener === 'boolean' ? target.canAccessOpener : undefined,
    openerFrameId: typeof target.openerFrameId === 'string' ? target.openerFrameId : undefined,
    browserContextId:
      typeof target.browserContextId === 'string' ? target.browserContextId : undefined,
    subtype: typeof target.subtype === 'string' ? target.subtype : undefined,
  };
}

export function readAttachedTargetSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const sessionId = (payload as AttachedToTargetPayload).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

export function readDetachedTargetSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const sessionId = (payload as DetachedFromTargetPayload).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

export function readTargetInfoPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const targetInfo = (payload as AttachedToTargetPayload | TargetInfoChangedPayload).targetInfo;
  return targetInfo && typeof targetInfo === 'object'
    ? (targetInfo as Record<string, unknown>)
    : null;
}
