export interface DOMInspectorElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}

export interface DOMInspectorClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ShadowDomWalkResult {
  roots: Array<Document | ShadowRoot>;
  shadowRootCount: number;
}

export interface DOMInspectorStructureNode {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  children?: DOMInspectorStructureNode[];
}

export interface DOMObserverOptions {
  selector?: string;
  childList?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree?: boolean;
}

interface WindowWithDomObserver extends Window {
  __domObserver?: MutationObserver;
}

/** Cap on textContent reported for query-all results (chars). */
const TEXT_CONTENT_MAX_CHARS = 500;
/** Cap on findByTextEvaluation XPath snapshot results. */
const XPATH_RESULT_LIMIT = 100;

const serializeForEvaluation = (value: string | number | undefined): string =>
  value === undefined ? 'undefined' : JSON.stringify(value);

/**
 * Visibility check (display/visibility/opacity) shared by the injected page
 * evaluations. String-built evaluations inline this source verbatim; the
 * function-reference evaluations (querySelectorEvaluation / findByTextEvaluation,
 * kept for Node-side callers) call {@link isVisible} instead. Both variants
 * stay self-contained because injected code runs in the page where module
 * scope is unreachable.
 */
const IS_VISIBLE_SOURCE = `function isVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}`;

/** Node-side visibility check used by direct (non-injected) evaluation calls. */
export function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

export const SHADOW_DOM_WALKER_SCRIPT = `
const walkShadowRoots = () => {
  const roots = [document];
  const queue = [document];
  let shadowRootCount = 0;
  while (queue.length > 0) {
    const root = queue.shift();
    if (!root) continue;
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const shadowRoot = element.shadowRoot;
      if (shadowRoot) {
        roots.push(shadowRoot);
        queue.push(shadowRoot);
        shadowRootCount += 1;
      }
    }
  }
  return { roots, shadowRootCount };
};
`.trim();

export function buildQueryAllEvaluation(selector: string, limit: number): string {
  return `
${SHADOW_DOM_WALKER_SCRIPT}
${IS_VISIBLE_SOURCE}
const selector = ${serializeForEvaluation(selector)};
const maxLimit = ${serializeForEvaluation(limit)};
const { roots, shadowRootCount } = walkShadowRoots();
const seen = new Set();
const results = [];
let totalMatches = 0;
for (const root of roots) {
  const nodeList = Array.from(root.querySelectorAll(selector));
  totalMatches += nodeList.length;
  for (const element of nodeList) {
    if (seen.has(element)) continue;
    seen.add(element);
    const attributes = {};
    for (const attr of Array.from(element.attributes)) {
      attributes[attr.name] = attr.value;
    }
    const rect = element.getBoundingClientRect();
    const textContent = element.textContent?.trim() || '';
    results.push({
      found: true,
      nodeName: element.nodeName,
      attributes,
      textContent: textContent.length > ${TEXT_CONTENT_MAX_CHARS} ? textContent.substring(0, ${TEXT_CONTENT_MAX_CHARS}) + '...[truncated]' : textContent,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisible(element),
    });
    if (results.length >= maxLimit) break;
  }
  if (results.length >= maxLimit) break;
}
if (totalMatches > maxLimit) {
  console.warn('[DOMInspector] Found ' + totalMatches + ' elements for "' + selector + '", limiting to ' + maxLimit);
}
return { elements: results, diagnostics: { readyState: document.readyState, shadowRootCount } };
`.trim();
}

export function buildFindClickableEvaluation(filterText?: string): string {
  return `
${SHADOW_DOM_WALKER_SCRIPT}
${IS_VISIBLE_SOURCE}
const filter = ${serializeForEvaluation(filterText)};
const normalizedFilter = filter?.toLowerCase();
const { roots, shadowRootCount } = walkShadowRoots();
const results = [];
const seen = new Set();
const appendClickable = (element, type, fallbackSelector) => {
  if (seen.has(element)) return;
  seen.add(element);
  const text = element.textContent?.trim() || (element.value ?? '').trim() || '';
  if (normalizedFilter && !text.toLowerCase().includes(normalizedFilter)) return;
  const rect = element.getBoundingClientRect();
  let selector = fallbackSelector;
  if (element.id) selector = '#' + element.id;
  else if (element.className) selector = fallbackSelector + '.' + element.className.split(' ')[0];
  results.push({
    selector,
    text,
    type,
    visible: isVisible(element) && rect.width > 0 && rect.height > 0,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  });
};
for (const root of roots) {
  root
    .querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]')
    .forEach((button) => appendClickable(button, 'button', button.tagName.toLowerCase()));
  root.querySelectorAll('a[href]').forEach((link) => appendClickable(link, 'link', 'a'));
}
return { elements: results, diagnostics: { readyState: document.readyState, shadowRootCount } };
`.trim();
}

export function querySelectorEvaluation(selector: string): DOMInspectorElementInfo {
  const element = document.querySelector(selector);
  if (!element) return { found: false };
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;
  const rect = element.getBoundingClientRect();
  return {
    found: true,
    nodeName: element.nodeName,
    attributes,
    textContent: element.textContent?.trim() || '',
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: isVisible(element),
  };
}

/**
 * String-built variant of {@link querySelectorEvaluation} for `page.evaluate`
 * injection — the function-reference form cannot carry module scope into the
 * page, so the self-contained check source is inlined instead.
 */
export function buildQuerySelectorEvaluation(selector: string): string {
  return `
${IS_VISIBLE_SOURCE}
const element = document.querySelector(${serializeForEvaluation(selector)});
if (!element) return { found: false };
const attributes = {};
for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;
const rect = element.getBoundingClientRect();
return {
  found: true,
  nodeName: element.nodeName,
  attributes,
  textContent: element.textContent?.trim() || '',
  boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  visible: isVisible(element),
};
`.trim();
}

export function getStructureEvaluation(
  depth: number,
  withText: boolean,
): DOMInspectorStructureNode | null {
  if (!document.body) {
    return null;
  }
  const buildTree = (node: Element, currentDepth: number): DOMInspectorStructureNode | null => {
    if (currentDepth > depth) return null;
    const result: DOMInspectorStructureNode = {
      tag: node.tagName,
      id: node.id || undefined,
      class: node.className || undefined,
    };
    if (withText && node.childNodes.length === 1 && node.childNodes[0]?.nodeType === 3) {
      result.text = node.textContent?.trim();
    }
    const children = Array.from(node.children)
      .map((child) => buildTree(child, currentDepth + 1))
      .filter((child): child is DOMInspectorStructureNode => child !== null);
    if (children.length > 0) result.children = children;
    return result;
  };
  return buildTree(document.body, 0);
}

export function getComputedStyleEvaluation(selector: string): Record<string, string> | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const computed = window.getComputedStyle(element);
  const result: Record<string, string> = {};
  for (const prop of [
    'display',
    'visibility',
    'opacity',
    'position',
    'zIndex',
    'width',
    'height',
    'top',
    'left',
    'right',
    'bottom',
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'border',
    'padding',
    'margin',
    'overflow',
  ]) {
    result[prop] = computed.getPropertyValue(prop);
  }
  return result;
}

export function observeDOMChangesEvaluation(opts: DOMObserverOptions): void {
  const targetNode = opts.selector ? document.querySelector(opts.selector) : document.body;
  if (!targetNode) {
    console.error('Target node not found for MutationObserver');
    return;
  }
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      console.warn('[DOM Change]', {
        type: mutation.type,
        target: mutation.target,
        addedNodes: mutation.addedNodes.length,
        removedNodes: mutation.removedNodes.length,
        attributeName: mutation.attributeName,
      });
    });
  });
  observer.observe(targetNode, {
    childList: opts.childList !== false,
    attributes: opts.attributes !== false,
    characterData: opts.characterData !== false,
    subtree: opts.subtree !== false,
  });
  (window as WindowWithDomObserver).__domObserver = observer;
}

export function stopObservingDOMEvaluation(): void {
  const typedWindow = window as WindowWithDomObserver;
  if (typedWindow.__domObserver) {
    typedWindow.__domObserver.disconnect();
    delete typedWindow.__domObserver;
  }
}

/** Build an XPath 1.0 string literal that embeds `value` verbatim. */
function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

/**
 * JS-source twin of {@link xpathStringLiteral} for string-built evaluations
 * (see {@link buildFindByTextEvaluation}). The concat() replacement is
 * emitted via JSON.stringify so the generated page code stays valid JS
 * (the value contains both quote kinds).
 */
const XPATH_STRING_LITERAL_SOURCE = `function xpathStringLiteral(value) {
  if (!value.includes("'")) return "'" + value + "'";
  if (!value.includes('"')) return '"' + value + '"';
  return "concat('" + value.replace(/'/g, ${JSON.stringify(`', "'", '`)}) + "')";
}`;

export function findByTextEvaluation(
  searchText: string,
  tagName?: string,
): Array<DOMInspectorElementInfo & { selector: string }> {
  // tagName flows into the XPath expression: restrict it to a valid HTML tag
  // name so it cannot inject predicates.
  const safeTag = tagName && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName) ? tagName : '*';
  const xpath = `//${safeTag}[contains(text(), ${xpathStringLiteral(searchText)})]`;
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const matchedElements: Array<DOMInspectorElementInfo & { selector: string }> = [];
  for (let i = 0; i < Math.min(result.snapshotLength, XPATH_RESULT_LIMIT); i++) {
    const element = result.snapshotItem(i) as Element | null;
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    let selector = element.tagName.toLowerCase();
    if (element.id) selector = `#${element.id}`;
    else if (element.className) {
      const classes = element.className.split(' ').filter(Boolean);
      if (classes.length > 0) selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
    matchedElements.push({
      found: true,
      nodeName: element.tagName,
      textContent: element.textContent?.trim(),
      selector,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisible(element),
    });
  }
  return matchedElements;
}

/**
 * String-built variant of {@link findByTextEvaluation} for `page.evaluate`
 * injection — inlines the shared visibility and XPath-literal sources
 * instead of relying on module scope.
 */
export function buildFindByTextEvaluation(searchText: string, tagName?: string): string {
  // tagName flows into the XPath expression: restrict it to a valid HTML tag
  // name so it cannot inject predicates.
  const safeTag = tagName && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName) ? tagName : '*';
  return `
${IS_VISIBLE_SOURCE}
${XPATH_STRING_LITERAL_SOURCE}
const searchText = ${serializeForEvaluation(searchText)};
const safeTag = ${serializeForEvaluation(safeTag)};
const xpath = '//' + safeTag + '[contains(text(), ' + xpathStringLiteral(searchText) + ')]';
const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
const matchedElements = [];
for (let i = 0; i < Math.min(result.snapshotLength, ${XPATH_RESULT_LIMIT}); i++) {
  const element = result.snapshotItem(i);
  if (!element) continue;
  const rect = element.getBoundingClientRect();
  let selector = element.tagName.toLowerCase();
  if (element.id) selector = '#' + element.id;
  else if (element.className) {
    const classes = element.className.split(' ').filter(Boolean);
    if (classes.length > 0) selector = element.tagName.toLowerCase() + '.' + classes[0];
  }
  matchedElements.push({
    found: true,
    nodeName: element.tagName,
    textContent: element.textContent?.trim(),
    selector,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: isVisible(element),
  });
}
return matchedElements;
`.trim();
}

export function getXPathEvaluation(selector: string): string | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    if (current.id) {
      parts.unshift(`//*[@id="${current.id}"]`);
      return parts.join('');
    }
    let ix = 0;
    const siblings: HTMLCollection | undefined = current.parentElement?.children;
    if (siblings) {
      for (let i = 0; i < siblings.length; i++) {
        const sibling: Element | undefined = siblings[i];
        if (!sibling) continue;
        if (sibling === current) break;
        if (sibling.tagName === current.tagName) ix += 1;
      }
    }
    parts.unshift(`/${current.tagName.toLowerCase()}[${ix + 1}]`);
    current = current.parentElement;
  }
  return '/html/body' + parts.join('');
}

export function isInViewportEvaluation(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
