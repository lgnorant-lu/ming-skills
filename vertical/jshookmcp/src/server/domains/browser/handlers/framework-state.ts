import { argString, argNumber } from '@server/domains/shared/parse-args';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface EvaluatablePage {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
  createCDPSession(): Promise<{
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  }>;
}

interface FrameworkStateHandlersDeps {
  getActivePage: () => Promise<unknown>;
}

export class FrameworkStateHandlers {
  constructor(private deps: FrameworkStateHandlersDeps) {}

  async handleFrameworkStateExtract(args: Record<string, unknown>): Promise<ToolResponse> {
    const framework = argString(args, 'framework', 'auto');
    const selector = argString(args, 'selector', '');
    const maxDepth = argNumber(args, 'maxDepth', 5);

    try {
      const page = (await this.deps.getActivePage()) as EvaluatablePage;

      // Pre-flight CDP health check: verify the page's CDP target is responsive.
      try {
        const cdp = await page.createCDPSession();
        await Promise.race([
          cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('cdp_unreachable')), 3000),
          ),
        ]);
      } catch {
        throw new PrerequisiteError(
          'CDP session unresponsive — the debugger may be blocking page evaluation. ' +
            "Call debugger_lifecycle({ action: 'disable' })() before framework_state_extract, or run it before " +
            "debugger_lifecycle({ action: 'enable' }).",
        );
      }

      // Wrap with 30s timeout to avoid hanging when CDP session is stale
      const evalPromise = page.evaluate(
        (opts: { framework: string; selector: string; maxDepth: number }) => {
          type AnyObj = Record<string, unknown>;
          const win = window as unknown as AnyObj;

          function safeSerialize(val: unknown, depth = 0): unknown {
            if (depth > 4) return '[deep]';
            if (val === null || val === undefined) return val;
            if (typeof val === 'function') return '[Function]';
            if (typeof val !== 'object') return val;
            if (Array.isArray(val)) {
              return (val as unknown[]).slice(0, 20).map((v) => safeSerialize(v, depth + 1));
            }
            try {
              const out: Record<string, unknown> = {};
              let count = 0;
              for (const k of Object.keys(val as object)) {
                if (count++ > 30) {
                  out['__truncated__'] = true;
                  break;
                }
                out[k] = safeSerialize((val as AnyObj)[k], depth + 1);
              }
              return out;
            } catch {
              return '[unserializable]';
            }
          }

          const getRootEl = (): Element => {
            if (opts.selector) {
              return document.querySelector(opts.selector) ?? document.body;
            }
            return (
              document.getElementById('root') ??
              document.getElementById('app') ??
              document.querySelector('[data-reactroot]') ??
              document.body
            );
          };

          // ── React ──
          const extractReact = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const fiberKey = Object.keys(rootObj).find(
              (k) =>
                k.startsWith('__reactFiber') ||
                k.startsWith('__reactInternalInstance') ||
                k.startsWith('__reactFiberContainer'),
            );
            if (!fiberKey) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitFiber = (fiber: AnyObj | null, depth: number): void => {
              if (!fiber || depth > opts.maxDepth || visited.has(fiber)) return;
              visited.add(fiber);

              if (fiber['memoizedState']) {
                const stateList: unknown[] = [];
                let s = fiber['memoizedState'] as AnyObj | null;
                let guard = 0;
                while (s && guard++ < 20) {
                  const queue = s['queue'] as AnyObj | undefined;
                  const val =
                    s['memoizedState'] !== undefined
                      ? s['memoizedState']
                      : queue?.['lastRenderedState'];
                  if (val !== undefined) stateList.push(safeSerialize(val));
                  s = (s['next'] as AnyObj | null | undefined) ?? null;
                }
                if (stateList.length > 0) {
                  const fiberType = fiber['type'] as AnyObj | string | undefined;
                  const componentName =
                    typeof fiberType === 'object' && fiberType !== null
                      ? String(fiberType['name'] ?? 'anonymous')
                      : typeof fiberType === 'string'
                        ? fiberType
                        : 'anonymous';
                  states.push({ component: componentName, state: stateList });
                }
              }

              visitFiber((fiber['child'] as AnyObj | null | undefined) ?? null, depth + 1);
              visitFiber((fiber['sibling'] as AnyObj | null | undefined) ?? null, depth + 1);
            };

            visitFiber((rootObj[fiberKey] as AnyObj | null | undefined) ?? null, 0);
            return states;
          };

          // ── Vue 3 ──
          const extractVue3 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find(
              (k) => k === '__vueParentComponent' || k === '__vue_app__' || k.startsWith('__vue'),
            );
            if (!vueKey) return null;

            const comp = rootObj[vueKey] as AnyObj | null;
            if (!comp) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitComp = (c: AnyObj, depth: number): void => {
              if (!c || depth > opts.maxDepth || visited.has(c)) return;
              visited.add(c);

              const setupState = safeSerialize(c['setupState'] ?? c['ctx']);
              const data = safeSerialize(c['$data'] ?? c['data']);
              if (setupState || data) {
                const compType = c['type'] as AnyObj | undefined;
                states.push({
                  component: compType?.['__name'] ?? 'unknown',
                  setupState,
                  data,
                });
              }

              const subTree = c['subTree'] as AnyObj | undefined;
              const children = subTree?.['children'];
              if (Array.isArray(children)) {
                for (const child of children as AnyObj[]) {
                  if (child?.['component']) {
                    visitComp(child['component'] as AnyObj, depth + 1);
                  }
                }
              }
            };

            visitComp(comp, 0);
            return states;
          };

          // ── Vue 2 ──
          const extractVue2 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find((k) => k === '__vue__');
            if (!vueKey) return null;

            const vm = rootObj[vueKey] as AnyObj | null;
            if (!vm) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitVm = (v: AnyObj, depth: number): void => {
              if (!v || depth > opts.maxDepth || visited.has(v)) return;
              visited.add(v);

              const options = v['$options'] as AnyObj | undefined;
              states.push({
                component: options?.['name'] ?? 'unknown',
                data: safeSerialize(v['$data']),
              });

              const children = v['$children'] as AnyObj[] | undefined;
              if (Array.isArray(children)) {
                for (const child of children) visitVm(child, depth + 1);
              }
            };

            visitVm(vm, 0);
            return states;
          };

          // ── Svelte 3/4/5 ──
          const extractSvelte = (): unknown[] | null => {
            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const svelteEls = document.querySelectorAll('[class]');
            const candidates = [getRootEl(), ...Array.from(svelteEls)];
            let foundAny = false;

            for (const el of candidates) {
              const obj = el as unknown as AnyObj;
              const keys = Object.keys(obj);

              const hasSvelte = keys.some(
                (k) => k === '$$' || k === '__svelte_meta' || k.startsWith('__s'),
              );
              if (!hasSvelte) continue;
              foundAny = true;

              const ctx = obj['$$'] as AnyObj | undefined;
              if (!ctx || visited.has(ctx)) continue;
              visited.add(ctx);

              const meta = obj['__svelte_meta'] as AnyObj | undefined;
              const componentName = (meta?.['loc'] as AnyObj | undefined)?.['file'] as
                | string
                | undefined;

              const ctxArray = ctx['ctx'] as unknown[] | undefined;
              const stateObj: AnyObj = {};
              if (Array.isArray(ctxArray)) {
                let idx = 0;
                for (const val of ctxArray.slice(0, 20)) {
                  if (val !== undefined && typeof val !== 'function') {
                    stateObj[`$${idx}`] = safeSerialize(val);
                  }
                  idx++;
                }
              }

              const fragment = ctx['fragment'] as AnyObj | undefined;

              if (Object.keys(stateObj).length > 0 || fragment) {
                states.push({
                  component: componentName ?? el.tagName?.toLowerCase() ?? 'svelte-component',
                  state: [stateObj],
                  ...(componentName ? { file: componentName } : {}),
                });
              }

              if (states.length >= 50) break;
            }

            return foundAny ? states : null;
          };

          // ── Solid.js ──
          const extractSolid = (): unknown[] | null => {
            const states: unknown[] = [];

            const dx = win['_$DX'] as AnyObj | undefined;
            const hy = win['_$HY'] as AnyObj | undefined;

            if (!dx && !hy) {
              const hydrationMarker = document.querySelector('[data-hk]');
              if (!hydrationMarker) return null;

              // Dynamic introspection: try to find Solid internals without devtools
              const probeSolidInternals = (): AnyObj | null => {
                // Solid stores ownership context in a global closure
                // Try to find it by examining window object properties
                for (const key of Object.keys(win)) {
                  if (key.startsWith('_$') || key.startsWith('$')) {
                    const val = win[key];
                    if (val && typeof val === 'object' && 'owner' in val) {
                      return val as AnyObj;
                    }
                  }
                }

                // Check DOM nodes for Solid internal properties
                const allElements = document.querySelectorAll('[data-hk]');
                for (const el of Array.from(allElements).slice(0, 10)) {
                  const elObj = el as unknown as AnyObj;
                  for (const prop of Object.keys(elObj)) {
                    if (prop.startsWith('_$') || prop.startsWith('$SOLID')) {
                      const val = elObj[prop];
                      if (val && typeof val === 'object') {
                        return val as AnyObj;
                      }
                    }
                  }
                }

                return null;
              };

              const internals = probeSolidInternals();
              if (internals) {
                // Found internal state, try to serialize it
                states.push({
                  component: 'SolidRoot',
                  state: [
                    {
                      _source: 'probed-internals',
                      _note: 'State extracted via dynamic introspection (no devtools)',
                      ...(safeSerialize(internals) as Record<string, unknown>),
                    },
                  ],
                });
                return states;
              }

              // Fallback: only hydration markers detected
              states.push({
                component: 'SolidRoot',
                state: [
                  {
                    _note:
                      'Solid detected via hydration markers; install solid-devtools for full state extraction',
                    _hydrationNodes: Array.from(document.querySelectorAll('[data-hk]')).length,
                  },
                ],
              });
              return states;
            }

            if (dx) {
              const roots = dx['roots'] as Map<unknown, AnyObj> | AnyObj | undefined;
              if (roots && typeof roots === 'object') {
                const entries =
                  roots instanceof Map ? Array.from(roots.values()) : Object.values(roots);
                let count = 0;
                for (const root of entries as AnyObj[]) {
                  if (count++ >= opts.maxDepth * 10) break;
                  const name = (root['name'] as string) ?? 'SolidComponent';
                  const value = root['value'] ?? root['state'];
                  states.push({
                    component: name,
                    state: value ? [safeSerialize(value)] : [],
                  });
                }
              }
            }

            if (hy && states.length === 0) {
              states.push({
                component: 'SolidHydration',
                state: [safeSerialize(hy)],
              });
            }

            return states.length > 0 ? states : null;
          };

          // ── Angular ──
          const extractAngular = (): unknown[] | null => {
            type NgReflectAttr = { name: string; value: string };
            type NgRootEntry = {
              tagName: string;
              contextType: string;
              ngReflectAttrs: NgReflectAttr[];
            };

            // Check for Angular debug tools (window.ng)
            const hasNgDebug = typeof win['ng'] !== 'undefined';

            // Check for Angular version attribute on the root element
            let ngVersion: string | null = null;
            try {
              const ngVersionEl = document.querySelector('[ng-version]');
              if (ngVersionEl && typeof ngVersionEl.getAttribute === 'function') {
                const v = ngVersionEl.getAttribute('ng-version');
                if (typeof v === 'string') ngVersion = v;
              }
            } catch {
              // selector or getAttribute may fail on non-standard DOMs
            }

            // Scan for elements with __ngContext__ (Angular 9+ Ivy)
            const roots: NgRootEntry[] = [];
            try {
              const allEls = document.querySelectorAll('*');
              const limit = Math.min(allEls.length, 1000);
              for (let i = 0; i < limit; i++) {
                const el = allEls[i] as unknown as AnyObj;
                if (el['__ngContext__'] !== undefined) {
                  const reflectAttrs: NgReflectAttr[] = [];
                  try {
                    if (el['attributes']) {
                      const attrs = el['attributes'] as ArrayLike<{ name: string; value: string }>;
                      for (let j = 0; j < attrs.length && reflectAttrs.length < 20; j++) {
                        const a = attrs[j];
                        if (!a) continue;
                        if (a.name.startsWith('ng-reflect-')) {
                          reflectAttrs.push({ name: a.name, value: a.value });
                        }
                      }
                    }
                  } catch {
                    // attributes access may fail
                  }
                  const rawTagName: unknown = el['tagName'];
                  roots.push({
                    tagName: typeof rawTagName === 'string' ? rawTagName : 'unknown',
                    contextType: typeof el['__ngContext__'],
                    ngReflectAttrs: reflectAttrs,
                  });
                }
                if (roots.length >= 10) break;
              }
            } catch {
              // querySelectorAll may fail
            }

            const detected = hasNgDebug || ngVersion !== null || roots.length > 0;
            if (!detected) return null;

            // Build state entries from roots and debug info
            const states: unknown[] = [];

            // Angular debug tools provide component inspection
            if (hasNgDebug) {
              states.push({
                component: 'AngularDebugTools',
                state: [{ _source: 'window.ng', available: true }],
              });
            }

            // Each root with __ngContext__
            for (const root of roots) {
              const stateObj: Record<string, unknown> = {
                _contextType: root.contextType,
              };
              if (root.ngReflectAttrs.length > 0) {
                for (const attr of root.ngReflectAttrs) {
                  // Convert ng-reflect-input-name → inputName
                  const cleanName = attr.name
                    .replace(/^ng-reflect-/, '')
                    .replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
                  stateObj[cleanName] = safeSerialize(attr.value);
                }
              }
              states.push({
                component: root.tagName,
                state: [stateObj],
              });
            }

            // If only version was found but no roots or debug tools, emit minimal metadata
            if (states.length === 0 && ngVersion !== null) {
              states.push({
                component: 'AngularApp',
                state: [
                  {
                    _version: ngVersion,
                    _note: 'Angular detected via [ng-version] attribute only',
                  },
                ],
              });
            }

            return states.length > 0 ? states : null;
          };

          // ── Preact ──
          const extractPreact = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const rootKeys = Object.keys(rootObj);

            if (
              rootKeys.some(
                (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
              )
            ) {
              return null;
            }

            const hasPreact = rootKeys.some((k) => k === '__k' || k === '__e' || k === '_dom');
            if (!hasPreact) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitVNode = (vnode: AnyObj | null, depth: number): void => {
              if (!vnode || depth > opts.maxDepth || visited.has(vnode)) return;
              visited.add(vnode);

              const component = vnode['__c'] as AnyObj | undefined;
              if (component) {
                const compState = component['state'] as AnyObj | undefined;
                const compProps = component['props'] as AnyObj | undefined;

                const hooks = component['__H'] as AnyObj | undefined;
                const hookStates: unknown[] = [];
                if (hooks) {
                  const list = hooks['__'] as AnyObj[] | undefined;
                  if (Array.isArray(list)) {
                    for (const h of list.slice(0, 20)) {
                      const val = h['__'] ?? h['_value'];
                      if (val !== undefined) hookStates.push(safeSerialize(val));
                    }
                  }
                }

                const typeName = vnode['type'] as AnyObj | string | undefined;
                const name =
                  typeof typeName === 'function'
                    ? ((typeName as AnyObj)['displayName'] ??
                      (typeName as AnyObj)['name'] ??
                      'PreactComponent')
                    : typeof typeName === 'string'
                      ? typeName
                      : 'PreactComponent';

                if (compState || hookStates.length > 0) {
                  states.push({
                    component: String(name),
                    state:
                      hookStates.length > 0
                        ? hookStates
                        : compState
                          ? [safeSerialize(compState)]
                          : [],
                    ...(compProps ? { props: safeSerialize(compProps) } : {}),
                  });
                }
              }

              const children = vnode['__k'] as AnyObj[] | undefined;
              if (Array.isArray(children)) {
                for (const child of children) {
                  if (child) visitVNode(child, depth + 1);
                }
              }
            };

            const rootVNode = rootObj['__k'] as AnyObj[] | undefined;
            if (Array.isArray(rootVNode)) {
              for (const vn of rootVNode) {
                if (vn) visitVNode(vn, 0);
              }
            } else if (rootObj['_children']) {
              const alt = rootObj['_children'] as AnyObj[] | undefined;
              if (Array.isArray(alt)) {
                for (const vn of alt) {
                  if (vn) visitVNode(vn, 0);
                }
              }
            }

            return states.length > 0 ? states : null;
          };

          // ── Meta-framework metadata (Next.js / Nuxt) ──
          const extractMetaFramework = (): AnyObj | null => {
            const nextData = win['__NEXT_DATA__'] as AnyObj | undefined;
            if (nextData) {
              return {
                framework: 'nextjs',
                route: nextData['page'] as string | undefined,
                buildId: nextData['buildId'] as string | undefined,
                runtimeConfig: safeSerialize(nextData['runtimeConfig']),
                props: safeSerialize(nextData['props']),
              };
            }

            const nuxt = win['__NUXT__'] as AnyObj | undefined;
            if (nuxt) {
              const isNuxt3 = nuxt['config'] !== undefined || nuxt['_errors'] !== undefined;
              if (isNuxt3) {
                return {
                  framework: 'nuxt3',
                  state: safeSerialize(nuxt['state']),
                  config: safeSerialize(nuxt['config']),
                  payload: safeSerialize(nuxt['data']),
                };
              }
              return {
                framework: 'nuxt2',
                state: safeSerialize(nuxt['state']),
                serverRendered: nuxt['serverRendered'],
              };
            }

            return null;
          };

          // ── Auto-detection ──
          const rootEl = getRootEl();
          const rootObj = rootEl as unknown as AnyObj;
          const keys = Object.keys(rootObj);
          const hasReactMarker = keys.some(
            (k) =>
              k.startsWith('__reactFiber') ||
              k.startsWith('__reactInternalInstance') ||
              k.startsWith('__reactFiberContainer'),
          );
          const hasVue3Marker = keys.some(
            (k) => k === '__vueParentComponent' || k === '__vue_app__',
          );
          const hasVue2Marker = keys.some((k) => k === '__vue__');
          const hasSvelteMarker = keys.some(
            (k) => k === '$$' || k === '__svelte_meta' || k.startsWith('__s'),
          );
          const hasSolidMarker =
            win['_$DX'] !== undefined ||
            win['_$HY'] !== undefined ||
            Boolean(document.querySelector('[data-hk]'));
          const hasPreactMarker = keys.some(
            (k) => k === '__k' || k === '__e' || k === '_dom' || k === '_children',
          );
          const hasAngularMarker =
            typeof win['ng'] !== 'undefined' || Boolean(document.querySelector('[ng-version]'));

          let detectedFramework = opts.framework;
          if (detectedFramework === 'preact' && hasReactMarker) {
            detectedFramework = 'react';
          }
          if (detectedFramework === 'auto') {
            if (hasReactMarker) {
              detectedFramework = 'react';
            } else if (hasVue3Marker) {
              detectedFramework = 'vue3';
            } else if (hasVue2Marker) {
              detectedFramework = 'vue2';
            } else if (hasSvelteMarker) {
              detectedFramework = 'svelte';
            } else if (hasSolidMarker) {
              detectedFramework = 'solid';
            } else if (hasAngularMarker) {
              detectedFramework = 'angular';
            } else if (hasPreactMarker) {
              detectedFramework = 'preact';
            }
          }

          let states: unknown[] | null = null;
          if (detectedFramework === 'react' || detectedFramework === 'auto') {
            states = extractReact();
          }
          if (!states && (detectedFramework === 'vue3' || detectedFramework === 'auto')) {
            states = extractVue3();
          }
          if (!states && (detectedFramework === 'vue2' || detectedFramework === 'auto')) {
            states = extractVue2();
          }
          if (!states && (detectedFramework === 'svelte' || detectedFramework === 'auto')) {
            states = extractSvelte();
          }
          if (!states && (detectedFramework === 'solid' || detectedFramework === 'auto')) {
            states = extractSolid();
          }
          if (!states && (detectedFramework === 'angular' || detectedFramework === 'auto')) {
            states = extractAngular();
          }
          if (!states && (detectedFramework === 'preact' || detectedFramework === 'auto')) {
            states = extractPreact();
          }

          const meta = extractMetaFramework();

          return {
            detected: detectedFramework,
            states: states ?? [],
            found: states !== null && states.length > 0,
            ...(meta ? { meta } : {}),
          };
        },
        { framework, selector, maxDepth },
      );

      const result = (await Promise.race([
        evalPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('page.evaluate timed out after 30000ms')), 30000),
        ),
      ])) as Record<string, unknown>;

      return R.ok().build(result);
    } catch (error) {
      return R.fail(error).build();
    }
  }
}
