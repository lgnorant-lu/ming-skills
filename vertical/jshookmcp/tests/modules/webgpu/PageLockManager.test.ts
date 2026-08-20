import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PageLockManager,
  getPageLockManager,
  resetPageLockManager,
} from '@modules/webgpu/PageLockManager';

describe('PageLockManager', () => {
  let manager: PageLockManager;

  beforeEach(() => {
    resetPageLockManager();
    manager = new PageLockManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('Basic Locking', () => {
    it('should execute function under lock', async () => {
      const result = await manager.withLock('page1', async () => {
        return 'executed';
      });

      expect(result).toBe('executed');
    });

    it('should return function result', async () => {
      const result = await manager.withLock('page1', async () => {
        return { data: 42 };
      });

      expect(result).toEqual({ data: 42 });
    });

    it('should propagate errors from function', async () => {
      await expect(
        manager.withLock('page1', async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');
    });

    it('should release lock after successful execution', async () => {
      await manager.withLock('page1', async () => {
        return 'done';
      });

      expect(manager.isLocked('page1')).toBe(false);
    });

    it('should release lock after error', async () => {
      await expect(
        manager.withLock('page1', async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');

      expect(manager.isLocked('page1')).toBe(false);
    });
  });

  describe('Concurrent Access Prevention', () => {
    it('should serialize access to same page', async () => {
      const execution: string[] = [];

      const promise1 = manager.withLock('page1', async () => {
        execution.push('start1');
        await new Promise((resolve) => setTimeout(resolve, 100));
        execution.push('end1');
        return 'result1';
      });

      const promise2 = manager.withLock('page1', async () => {
        execution.push('start2');
        await new Promise((resolve) => setTimeout(resolve, 50));
        execution.push('end2');
        return 'result2';
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(execution).toEqual(['start1', 'end1', 'start2', 'end2']);
    });

    it('should allow parallel access to different pages', async () => {
      const execution: string[] = [];

      const promise1 = manager.withLock('page1', async () => {
        execution.push('page1-start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        execution.push('page1-end');
        return 'result1';
      });

      const promise2 = manager.withLock('page2', async () => {
        execution.push('page2-start');
        await new Promise((resolve) => setTimeout(resolve, 50));
        execution.push('page2-end');
        return 'result2';
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      // Both should start before either ends (parallel execution)
      expect(execution).toContain('page1-start');
      expect(execution).toContain('page2-start');
      expect(execution.indexOf('page2-end')).toBeLessThan(execution.indexOf('page1-end'));
    });

    it('should handle multiple concurrent requests on same page', async () => {
      const execution: number[] = [];

      const promises = Array.from({ length: 5 }, (_, i) =>
        manager.withLock('page1', async () => {
          execution.push(i);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return i;
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toEqual([0, 1, 2, 3, 4]);
      expect(execution).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('Lock State Management', () => {
    it('should report locked state during execution', async () => {
      let wasLocked = false;

      await manager.withLock('page1', async () => {
        wasLocked = manager.isLocked('page1');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(wasLocked).toBe(true);
      expect(manager.isLocked('page1')).toBe(false);
    });

    it('should track active lock count', async () => {
      expect(manager.getActiveLockCount()).toBe(0);

      const promise1 = manager.withLock('page1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const promise2 = manager.withLock('page2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Wait a bit for locks to be acquired
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getActiveLockCount()).toBeGreaterThan(0);

      await Promise.all([promise1, promise2]);

      expect(manager.getActiveLockCount()).toBe(0);
    });

    it('should check lock state for specific page', async () => {
      expect(manager.isLocked('page1')).toBe(false);

      const promise = manager.withLock('page1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Wait for lock to be acquired
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.isLocked('page1')).toBe(true);
      expect(manager.isLocked('page2')).toBe(false);

      await promise;

      expect(manager.isLocked('page1')).toBe(false);
    });
  });

  describe('Cleanup', () => {
    it('should clear all locks', async () => {
      const promise1 = manager.withLock('page1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const promise2 = manager.withLock('page2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Wait for locks to be acquired
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getActiveLockCount()).toBeGreaterThan(0);

      manager.clearAll();

      expect(manager.getActiveLockCount()).toBe(0);

      // Original promises should still resolve
      await expect(Promise.all([promise1, promise2])).resolves.toBeDefined();
    });
  });

  describe('Singleton Instance', () => {
    it('should return same instance', () => {
      const instance1 = getPageLockManager();
      const instance2 = getPageLockManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getPageLockManager();
      resetPageLockManager();
      const instance2 = getPageLockManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
