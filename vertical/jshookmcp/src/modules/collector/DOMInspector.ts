import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import {
  buildFindByTextEvaluation,
  buildFindClickableEvaluation,
  buildQueryAllEvaluation,
  buildQuerySelectorEvaluation,
  getComputedStyleEvaluation,
  getStructureEvaluation,
  getXPathEvaluation,
  isInViewportEvaluation,
  observeDOMChangesEvaluation,
  stopObservingDOMEvaluation,
  type DOMInspectorClickableElement,
  type DOMInspectorElementInfo,
  type DOMInspectorStructureNode,
  type DOMObserverOptions,
} from '@modules/collector/DOMInspector.evaluations';
import { logger } from '@utils/logger';
import {
  DOM_QUERY_DEFAULT_LIMIT,
  DOM_WAIT_ELEMENT_TIMEOUT_MS,
  DOM_QUERY_INPUT_MAX_CHARS,
  DOM_READY_STATE_POLL_INTERVAL_MS,
  DOM_EMPTY_RESULT_RETRY_DELAY_MS,
  DOM_DEFAULT_READY_STATE_TIMEOUT_MS,
} from '@src/constants';

export type {
  DOMInspectorClickableElement,
  DOMInspectorElementInfo,
  ShadowDomWalkResult,
} from '@modules/collector/DOMInspector.evaluations';

export type ElementInfo = DOMInspectorElementInfo;
export type ClickableElement = DOMInspectorClickableElement;

export interface DOMQueryDiagnostics {
  readyState: string;
  frameCount: number;
  shadowRootCount: number;
  retried: boolean;
  waitedForReadyState: boolean;
}

export interface DOMQueryAllResult {
  elements: ElementInfo[];
  diagnostics: DOMQueryDiagnostics;
}

export interface DOMFindClickableResult {
  elements: ClickableElement[];
  diagnostics: DOMQueryDiagnostics;
}

type DOMStructureNode = DOMInspectorStructureNode;
type DOMEvaluationDiagnostics = Pick<DOMQueryDiagnostics, 'readyState' | 'shadowRootCount'>;
type DOMQueryAllEvaluationResult = {
  elements: ElementInfo[];
  diagnostics: DOMEvaluationDiagnostics;
};
type DOMFindClickableEvaluationResult = {
  elements: ClickableElement[];
  diagnostics: DOMEvaluationDiagnostics;
};

/** Cap on caller-supplied selectors / filter text fed into string-built evaluations. */
const QUERY_INPUT_MAX_CHARS = DOM_QUERY_INPUT_MAX_CHARS;

/**
 * Input gate for the string-built evaluations. The build* helpers already
 * embed caller input via JSON.stringify (quotes/newlines are escaped), so no
 * code injection is possible; this adds a length/NUL guard for defense in
 * depth before the transport Function is constructed (same pattern as
 * CRIT-01's validateCodeSafety).
 */
function assertSafeQueryInput(value: string, field: string): void {
  if (value.length > QUERY_INPUT_MAX_CHARS) {
    throw new Error(`${field} exceeds ${QUERY_INPUT_MAX_CHARS} characters`);
  }
  if (value.includes('\u0000')) {
    throw new Error(`${field} contains NUL`);
  }
}

export class DOMInspector {
  protected collector: CodeCollector;
  protected cdpSession: CDPSession | null = null;

  /** Default wait for the page to reach readyState 'complete' (ms). */
  private static readonly READY_STATE_POLL_INTERVAL_MS = DOM_READY_STATE_POLL_INTERVAL_MS;
  /** Retry delay before re-running an empty query after readyState 'complete' (ms). */
  private static readonly EMPTY_RESULT_RETRY_DELAY_MS = DOM_EMPTY_RESULT_RETRY_DELAY_MS;
  /** Default readyState wait budget when the caller does not supply one (ms). */
  private static readonly DEFAULT_READY_STATE_TIMEOUT_MS = DOM_DEFAULT_READY_STATE_TIMEOUT_MS;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  private async waitForReadyState(
    page: { evaluate: <T>(fn: () => T) => Promise<T>; frames?: () => unknown[] },
    timeoutMs = DOMInspector.DEFAULT_READY_STATE_TIMEOUT_MS,
  ): Promise<{ readyState: string; waitedForReadyState: boolean; frameCount: number }> {
    const deadline = Date.now() + timeoutMs;
    let waitedForReadyState = false;
    let readyState = 'unknown';

    while (Date.now() <= deadline) {
      readyState = await page.evaluate(() => document.readyState).catch(() => 'unknown');
      if (readyState === 'complete') break;
      waitedForReadyState = true;
      await new Promise((resolve) =>
        setTimeout(resolve, DOMInspector.READY_STATE_POLL_INTERVAL_MS),
      );
    }

    return {
      readyState,
      waitedForReadyState,
      frameCount: typeof page.frames === 'function' ? page.frames().length : 1,
    };
  }

  /**
   * Run an evaluate query, retrying once when it returns zero elements on a
   * 'complete' document (late-rendered content). Shared by querySelectorAll
   * and findClickable — previously the wait/retry/diagnostics block was
   * duplicated verbatim.
   */
  private async runQueryWithRetry<
    T extends { elements: unknown[]; diagnostics: { readyState: string } },
  >(
    page: { evaluate: <R>(fn: () => R) => Promise<R> },
    runQuery: () => Promise<T>,
  ): Promise<{
    result: T;
    retried: boolean;
    readyStateStatus: Awaited<ReturnType<DOMInspector['waitForReadyState']>>;
  }> {
    const readyStateStatus = await this.waitForReadyState(page);
    let result = await runQuery();
    let retried = false;
    if (result.elements.length === 0 && result.diagnostics.readyState === 'complete') {
      retried = true;
      await new Promise((resolve) => setTimeout(resolve, DOMInspector.EMPTY_RESULT_RETRY_DELAY_MS));
      result = await runQuery();
    }
    return { result, retried, readyStateStatus };
  }

  async querySelector(selector: string, _getAttributes = true): Promise<ElementInfo> {
    try {
      assertSafeQueryInput(selector, 'selector');
      const page = await this.collector.getActivePage();
      const elementInfo = await page.evaluate(
        new Function(buildQuerySelectorEvaluation(selector)) as () => ElementInfo,
      );
      logger.info(`querySelector: ${selector} - ${elementInfo.found ? 'found' : 'not found'}`);
      return elementInfo;
    } catch (error) {
      logger.error(`querySelector failed for ${selector}:`, error);
      return { found: false };
    }
  }

  async querySelectorAll(
    selector: string,
    limit = DOM_QUERY_DEFAULT_LIMIT,
  ): Promise<DOMQueryAllResult> {
    try {
      assertSafeQueryInput(selector, 'selector');
      const page = await this.collector.getActivePage();
      const runQuery = async () =>
        page.evaluate(
          new Function(
            buildQueryAllEvaluation(selector, limit),
          ) as () => DOMQueryAllEvaluationResult,
        );

      const { result, retried, readyStateStatus } = await this.runQueryWithRetry(page, runQuery);

      const diagnostics: DOMQueryDiagnostics = {
        readyState: result.diagnostics.readyState ?? readyStateStatus.readyState,
        frameCount: readyStateStatus.frameCount,
        shadowRootCount: result.diagnostics.shadowRootCount ?? 0,
        retried,
        waitedForReadyState: readyStateStatus.waitedForReadyState,
      };

      logger.info(
        `querySelectorAll: ${selector} - found ${result.elements.length} elements (limit: ${limit}, readyState: ` +
          `${diagnostics.readyState}, shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`,
      );
      return { elements: result.elements, diagnostics };
    } catch (error) {
      logger.error(`querySelectorAll failed for ${selector}:`, error);
      return {
        elements: [],
        diagnostics: {
          readyState: 'error',
          frameCount: 0,
          shadowRootCount: 0,
          retried: false,
          waitedForReadyState: false,
        },
      };
    }
  }

  async getStructure(maxDepth = 3, includeText = true): Promise<DOMStructureNode | null> {
    try {
      const page = await this.collector.getActivePage();
      const structure = await page.evaluate(getStructureEvaluation, maxDepth, includeText);
      logger.info('DOM structure retrieved');
      return structure;
    } catch (error) {
      logger.error('getStructure failed:', error);
      return null;
    }
  }

  async findClickable(filterText?: string): Promise<DOMFindClickableResult> {
    try {
      assertSafeQueryInput(filterText ?? '', 'filterText');
      const page = await this.collector.getActivePage();
      const runQuery = async () =>
        page.evaluate(
          new Function(
            buildFindClickableEvaluation(filterText),
          ) as () => DOMFindClickableEvaluationResult,
        );

      const { result, retried, readyStateStatus } = await this.runQueryWithRetry(page, runQuery);

      const diagnostics: DOMQueryDiagnostics = {
        readyState: result.diagnostics.readyState ?? readyStateStatus.readyState,
        frameCount: readyStateStatus.frameCount,
        shadowRootCount: result.diagnostics.shadowRootCount ?? 0,
        retried,
        waitedForReadyState: readyStateStatus.waitedForReadyState,
      };

      logger.info(
        `findClickable: found ${result.elements.length} elements` +
          `${filterText ? ` (filtered by: ${filterText})` : ''} (readyState: ${diagnostics.readyState}, ` +
          `shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`,
      );
      return { elements: result.elements, diagnostics };
    } catch (error) {
      logger.error('findClickable failed:', error);
      return {
        elements: [],
        diagnostics: {
          readyState: 'error',
          frameCount: 0,
          shadowRootCount: 0,
          retried: false,
          waitedForReadyState: false,
        },
      };
    }
  }

  async getComputedStyle(selector: string): Promise<Record<string, string> | null> {
    try {
      const page = await this.collector.getActivePage();
      const styles = await page.evaluate(getComputedStyleEvaluation, selector);
      logger.info(`getComputedStyle: ${selector} - ${styles ? 'found' : 'not found'}`);
      return styles;
    } catch (error) {
      logger.error(`getComputedStyle failed for ${selector}:`, error);
      return null;
    }
  }

  async waitForElement(
    selector: string,
    timeout = DOM_WAIT_ELEMENT_TIMEOUT_MS,
  ): Promise<ElementInfo | null> {
    try {
      const page = await this.collector.getActivePage();
      await page.waitForSelector(selector, { timeout });
      return await this.querySelector(selector);
    } catch (error) {
      logger.error(`waitForElement timeout for ${selector}:`, error);
      return null;
    }
  }

  async observeDOMChanges(options: DOMObserverOptions = {}): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(observeDOMChangesEvaluation, options);
    logger.info('DOM change observer started');
  }

  async stopObservingDOM(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(stopObservingDOMEvaluation);
    logger.info('DOM change observer stopped');
  }

  async findByText(text: string, tag?: string): Promise<ElementInfo[]> {
    try {
      assertSafeQueryInput(text, 'text');
      const page = await this.collector.getActivePage();
      const elements = await page.evaluate(
        new Function(buildFindByTextEvaluation(text, tag)) as () => Array<
          ElementInfo & { selector: string }
        >,
      );
      logger.info(`findByText: "${text}" - found ${elements.length} elements`);
      return elements;
    } catch (error) {
      logger.error(`findByText failed for "${text}":`, error);
      return [];
    }
  }

  async getXPath(selector: string): Promise<string | null> {
    try {
      const page = await this.collector.getActivePage();
      const xpath = await page.evaluate(getXPathEvaluation, selector);
      logger.info(`getXPath: ${selector} -> ${xpath}`);
      return xpath;
    } catch (error) {
      logger.error(`getXPath failed for ${selector}:`, error);
      return null;
    }
  }

  async isInViewport(selector: string): Promise<boolean> {
    try {
      const page = await this.collector.getActivePage();
      const inViewport = await page.evaluate(isInViewportEvaluation, selector);
      logger.info(`isInViewport: ${selector} - ${inViewport}`);
      return inViewport;
    } catch (error) {
      logger.error(`isInViewport failed for ${selector}:`, error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
      logger.info('DOM Inspector CDP session closed');
    }
  }
}
