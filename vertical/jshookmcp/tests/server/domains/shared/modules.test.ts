import { describe, expect, it } from 'vitest';
import * as Modules from '@server/domains/shared/modules';
import * as CollectorModules from '@server/domains/shared/modules/collector';
import * as NativeModules from '@server/domains/shared/modules/native';

describe('shared/modules', () => {
  it('should export core shared modules', () => {
    expect(Modules.CodeAnalyzer).toBeDefined();
    expect(Modules.DebuggerManager).toBeDefined();
  });

  it('should export collector modules via sub-barrel', () => {
    expect(CollectorModules.DOMInspector).toBeDefined();
    expect(CollectorModules.CodeCollector).toBeDefined();
    expect(CollectorModules.PageController).toBeDefined();
    expect(CollectorModules.ConsoleMonitor).toBeDefined();
  });

  it('should export native modules via sub-barrel', () => {
    expect(NativeModules.MemoryManager).toBeDefined();
    expect(NativeModules.UnifiedProcessManager).toBeDefined();
  });
});
