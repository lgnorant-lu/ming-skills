import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findByTextEvaluation,
  getStructureEvaluation,
} from '@modules/collector/DOMInspector.evaluations';

describe('DOMInspector.evaluations bug fixes', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><button>Click me</button></body></html>', {
      url: 'https://example.com/',
    });
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).XPathResult = dom.window.XPathResult;
  });

  it('escapes quotes in searchText so XPath stays well-formed', () => {
    // Unescaped, the embedded double quotes would break the XPath literal and
    // document.evaluate would throw a syntax error.
    const elements = findByTextEvaluation('Say "hi" to Bob');
    expect(Array.isArray(elements)).toBe(true);
  });

  it('treats injection-style searchText as a literal instead of executing it', () => {
    const elements = findByTextEvaluation(`x") or 1=1 or ("x`, 'button');
    // With a single button whose text does not match, the injected predicate
    // must NOT broaden the query.
    expect(elements).toHaveLength(0);
  });

  it('keeps matching behavior for plain text', () => {
    const elements = findByTextEvaluation('Click me', 'button');
    expect(elements).toHaveLength(1);
    expect(elements[0]?.textContent).toBe('Click me');
  });

  it('returns null when document.body is missing', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><p>x</p></body></html>');
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;

    dom.window.document.body?.remove();
    expect(getStructureEvaluation(3, true)).toBeNull();
  });
});
