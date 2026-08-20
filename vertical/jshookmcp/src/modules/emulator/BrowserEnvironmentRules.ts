export type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera';
export type EnvironmentCategory =
  | 'window'
  | 'document'
  | 'navigator'
  | 'location'
  | 'screen'
  | 'performance'
  | 'console'
  | 'storage'
  | 'crypto'
  | 'other';

type EnvironmentDefaultValueResolver = (browser: BrowserType, version: string) => unknown;

export interface EnvironmentRule {
  path: string;
  category: EnvironmentCategory;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'undefined' | 'null';
  defaultValue?: unknown | EnvironmentDefaultValueResolver;
  readonly?: boolean;
  required?: boolean;
  description?: string;
  browsers?: BrowserType[];
  minVersion?: Record<BrowserType, string>;
  antiCrawlImportance?: number;
}
export interface BrowserConfig {
  type: BrowserType;
  version: string;
  userAgent: string;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  pixelRatio: number;
}
import {
  createDefaultBrowserConfigs,
  generateUserAgentFromConfig,
  getPlatformFromConfig,
  getVendorFromConfig,
} from '@modules/emulator/BrowserEnvironmentConfigHelpers';

/**
 * Shared default values for the emulated browser environment. Kept in one
 * table so navigator/screen/window rules agree on the same device profile.
 */
const BROWSER_ENV_DEFAULTS = {
  language: 'zh-CN',
  languages: ['zh-CN', 'zh', 'en-US', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  screenAvailWidth: 1920,
  screenAvailHeight: 1040,
  colorDepth: 24,
  pixelDepth: 24,
  windowInnerWidth: 1920,
  windowInnerHeight: 1080,
  windowOuterWidth: 1920,
  windowOuterHeight: 1080,
  devicePixelRatio: 1,
  screenX: 0,
  screenY: 0,
  /** Placeholder origin used by the location.* / document.* rules. */
  exampleUrl: 'https://www.example.com',
  exampleHost: 'www.example.com',
} as const;

export class BrowserEnvironmentRulesManager {
  private rules: Map<string, EnvironmentRule> = new Map();
  private browserConfigs: Map<BrowserType, BrowserConfig> = new Map();
  constructor() {
    this.browserConfigs = createDefaultBrowserConfigs();
    this.initializeDefaultRules();
  }
  private initializeDefaultRules(): void {
    this.addRule({
      path: 'navigator.userAgent',
      category: 'navigator',
      type: 'string',
      required: true,
      antiCrawlImportance: 10,
      description: 'User agent string',
      defaultValue: (browser: BrowserType, version: string) =>
        generateUserAgentFromConfig(browser, version, this.browserConfigs),
    });
    this.addRule({
      path: 'navigator.platform',
      category: 'navigator',
      type: 'string',
      required: true,
      antiCrawlImportance: 9,
      defaultValue: (browser: BrowserType) => getPlatformFromConfig(browser, this.browserConfigs),
    });
    this.addRule({
      path: 'navigator.vendor',
      category: 'navigator',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: (browser: BrowserType) => getVendorFromConfig(browser, this.browserConfigs),
    });
    this.addRule({
      path: 'navigator.language',
      category: 'navigator',
      type: 'string',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.language,
    });
    this.addRule({
      path: 'navigator.languages',
      category: 'navigator',
      type: 'array',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.languages,
    });
    this.addRule({
      path: 'navigator.hardwareConcurrency',
      category: 'navigator',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.hardwareConcurrency,
    });
    this.addRule({
      path: 'navigator.deviceMemory',
      category: 'navigator',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.deviceMemory,
      browsers: ['chrome', 'edge', 'opera'],
    });
    this.addRule({
      path: 'navigator.maxTouchPoints',
      category: 'navigator',
      type: 'number',
      required: true,
      antiCrawlImportance: 5,
      defaultValue: BROWSER_ENV_DEFAULTS.maxTouchPoints,
    });
    this.addRule({
      path: 'navigator.webdriver',
      category: 'navigator',
      type: 'boolean',
      required: true,
      antiCrawlImportance: 10,
      defaultValue: false,
      description: 'Critical for anti-detection',
    });
    this.addRule({
      path: 'navigator.cookieEnabled',
      category: 'navigator',
      type: 'boolean',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: true,
    });
    this.addRule({
      path: 'navigator.onLine',
      category: 'navigator',
      type: 'boolean',
      required: true,
      antiCrawlImportance: 4,
      defaultValue: true,
    });
    this.addRule({
      path: 'navigator.doNotTrack',
      category: 'navigator',
      type: 'string',
      required: false,
      antiCrawlImportance: 3,
      defaultValue: null,
    });
    this.addRule({
      path: 'navigator.pdfViewerEnabled',
      category: 'navigator',
      type: 'boolean',
      required: false,
      antiCrawlImportance: 4,
      defaultValue: true,
      browsers: ['chrome', 'edge', 'opera'],
    });
    this.addRule({
      path: 'screen.width',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.screenWidth,
    });
    this.addRule({
      path: 'screen.height',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.screenHeight,
    });
    this.addRule({
      path: 'screen.availWidth',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.screenAvailWidth,
    });
    this.addRule({
      path: 'screen.availHeight',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.screenAvailHeight,
    });
    this.addRule({
      path: 'screen.colorDepth',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.colorDepth,
    });
    this.addRule({
      path: 'screen.pixelDepth',
      category: 'screen',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.pixelDepth,
    });
    this.addRule({
      path: 'window.innerWidth',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.windowInnerWidth,
    });
    this.addRule({
      path: 'window.innerHeight',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.windowInnerHeight,
    });
    this.addRule({
      path: 'window.outerWidth',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.windowOuterWidth,
    });
    this.addRule({
      path: 'window.outerHeight',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: BROWSER_ENV_DEFAULTS.windowOuterHeight,
    });
    this.addRule({
      path: 'window.devicePixelRatio',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: BROWSER_ENV_DEFAULTS.devicePixelRatio,
    });
    this.addRule({
      path: 'window.screenX',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 4,
      defaultValue: BROWSER_ENV_DEFAULTS.screenX,
    });
    this.addRule({
      path: 'window.screenY',
      category: 'window',
      type: 'number',
      required: true,
      antiCrawlImportance: 4,
      defaultValue: BROWSER_ENV_DEFAULTS.screenY,
    });
    this.addRule({
      path: 'location.href',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleUrl,
    });
    this.addRule({
      path: 'location.protocol',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: 'https:',
    });
    this.addRule({
      path: 'location.host',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleHost,
    });
    this.addRule({
      path: 'location.hostname',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleHost,
    });
    this.addRule({
      path: 'location.port',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: '',
    });
    this.addRule({
      path: 'location.pathname',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: '/',
    });
    this.addRule({
      path: 'location.search',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: '',
    });
    this.addRule({
      path: 'location.hash',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 5,
      defaultValue: '',
    });
    this.addRule({
      path: 'location.origin',
      category: 'location',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleUrl,
    });
    this.addRule({
      path: 'document.title',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 5,
      defaultValue: '',
    });
    this.addRule({
      path: 'document.URL',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleUrl,
    });
    this.addRule({
      path: 'document.domain',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 8,
      defaultValue: BROWSER_ENV_DEFAULTS.exampleHost,
    });
    this.addRule({
      path: 'document.referrer',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: '',
    });
    this.addRule({
      path: 'document.cookie',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 9,
      defaultValue: '',
    });
    this.addRule({
      path: 'document.readyState',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: 'complete',
    });
    this.addRule({
      path: 'document.characterSet',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 5,
      defaultValue: 'UTF-8',
    });
    this.addRule({
      path: 'document.hidden',
      category: 'document',
      type: 'boolean',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: false,
    });
    this.addRule({
      path: 'document.visibilityState',
      category: 'document',
      type: 'string',
      required: true,
      antiCrawlImportance: 6,
      defaultValue: 'visible',
    });
    this.addRule({
      path: 'performance.timing.navigationStart',
      category: 'performance',
      type: 'number',
      required: false,
      antiCrawlImportance: 5,
      defaultValue: () => Date.now() - Math.random() * 10000,
    });
    this.addRule({
      path: 'performance.timing.loadEventEnd',
      category: 'performance',
      type: 'number',
      required: false,
      antiCrawlImportance: 4,
      defaultValue: () => Date.now() - Math.random() * 5000,
    });
    this.addRule({
      path: 'localStorage',
      category: 'storage',
      type: 'object',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: {},
    });
    this.addRule({
      path: 'sessionStorage',
      category: 'storage',
      type: 'object',
      required: true,
      antiCrawlImportance: 7,
      defaultValue: {},
    });
    this.addRule({
      path: 'crypto.subtle',
      category: 'crypto',
      type: 'object',
      required: false,
      antiCrawlImportance: 6,
      defaultValue: {},
      browsers: ['chrome', 'firefox', 'safari', 'edge'],
    });
    this.addRule({
      path: 'crypto.getRandomValues',
      category: 'crypto',
      type: 'function',
      required: false,
      antiCrawlImportance: 7,
      defaultValue: function (array: unknown) {
        // Real getRandomValues fills the caller's buffer with random bytes —
        // a pass-through that returns the untouched array breaks any code
        // that reads the values.
        if (ArrayBuffer.isView(array)) {
          if (
            typeof globalThis.crypto !== 'undefined' &&
            typeof globalThis.crypto.getRandomValues === 'function'
          ) {
            globalThis.crypto.getRandomValues(array as ArrayBufferView<ArrayBuffer>);
          } else {
            const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
            for (let i = 0; i < bytes.length; i += 1) {
              bytes[i] = Math.floor(Math.random() * 256);
            }
          }
        }
        return array;
      },
    });
  }
  addRule(rule: EnvironmentRule): void {
    this.rules.set(rule.path, rule);
  }
  getRule(path: string): EnvironmentRule | undefined {
    return this.rules.get(path);
  }
  getAllRules(): EnvironmentRule[] {
    return Array.from(this.rules.values());
  }
  getRulesByCategory(category: EnvironmentCategory): EnvironmentRule[] {
    return this.getAllRules().filter((rule) => rule.category === category);
  }
  exportToJSON(): string {
    const data = {
      rules: Array.from(this.rules.entries()),
      browserConfigs: Array.from(this.browserConfigs.entries()),
    };
    return JSON.stringify(data, null, 2);
  }
  loadFromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.rules) {
      this.rules = new Map(data.rules);
    }
    if (data.browserConfigs) {
      this.browserConfigs = new Map(data.browserConfigs);
    }
  }
}
