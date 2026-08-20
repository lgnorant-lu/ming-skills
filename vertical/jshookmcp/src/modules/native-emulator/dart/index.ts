/**
 * dart/ — Dart AOT snapshot parsing and execution layer.
 *
 * Exports:
 *  - SnapshotParser: Parse Dart snapshot headers, clusters, Code objects
 *  - DartRuntime: Dart VM calling convention (tagged pointers, special registers)
 *  - ObjectPool: Constant pool management and PP-relative load resolution
 *  - DartBuiltins: Mock implementations of Dart VM built-in functions
 *  - DartAotLoader: Load and parse snapshots from APK or libapp.so
 *  - DartAotExecutor: Execute Dart functions in the ARM64 emulator
 */

export * from './SnapshotParser';
export * from './DartRuntime';
export * from './ObjectPool';
export * from './DartBuiltins';
export * from './DartAotLoader';
export * from './DartAotExecutor';
export * from './PcDescriptorsParser';
