import { CDP_SESSION_TIMEOUT_MS } from '@src/constants';

/**
 * createCDPSession() can hang — or resolve after we already gave up on it.
 * Race it against CDP_SESSION_TIMEOUT_MS and, when the timeout wins, detach
 * the late-resolving session as an untracked orphan instead of leaking a
 * native browser-level resource. Rejects with 'cdp_session_timeout' on
 * timeout, matching the callers' existing error contract.
 */
export async function createCDPSessionWithTimeout<T extends { detach(): Promise<unknown> }>(page: {
  createCDPSession(): Promise<T>;
}): Promise<T> {
  const createPromise = page.createCDPSession();
  return Promise.race([
    createPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('cdp_session_timeout')), CDP_SESSION_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    createPromise.then((orphan) => void orphan.detach().catch(() => {})).catch(() => {});
    throw err;
  });
}
