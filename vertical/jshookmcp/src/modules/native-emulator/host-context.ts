/** Register and guest-memory access passed to host functions and syscall handlers. */
export interface HostContext {
  x(index: number): bigint;
  setX(index: number, value: bigint): void;
  setD(index: number, value: number): void;
  read(address: number, length: number): Uint8Array;
  write(address: number, bytes: Uint8Array): void;
  /** Set the ARM64 carry flag (C in NZCV). Use to break out of bytecode loops. */
  setCarry?(value: boolean): void;
  /** Lock a register to a value — rewritten after EVERY subsequent instruction. */
  persistReg?(index: number, value: bigint): void;
  /** Release a register locked by persistReg. */
  unpersistReg?(index: number): void;
  /** Current stack pointer. */
  sp?: bigint;
  /** Save registers x0-x30+sp into an opaque snapshot (returned as a number handle). */
  saveRegs?(): number;
  /** Restore registers from a snapshot handle previously returned by saveRegs(). */
  restoreRegs?(handle: number): void;
  /** Read a multi-byte value from guest memory (LE). */
  loadValue?(address: number, bytes: number): bigint;
  /** Write a multi-byte value to guest memory (LE). */
  storeValue?(address: number, bytes: number, value: bigint): void;
}

export type HostFunction = (ctx: HostContext) => bigint | number | void;
export type SyscallContext = HostContext;
