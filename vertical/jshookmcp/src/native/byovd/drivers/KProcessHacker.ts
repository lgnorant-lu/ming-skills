/**
 * KProcessHacker.sys driver definition (Process Hacker 2.x).
 *
 * Process Hacker's signed kernel driver exposes process manipulation
 * capabilities through its IOCTL interface.  When loaded via BYOVD, it
 * can be used to:
 *
 *   - Read/write virtual memory of arbitrary processes
 *   - Terminate protected processes (including PPL)
 *   - Suspend/resume processes at kernel level
 *
 * The Reaper PoC demonstrated these capabilities.
 *
 * NOTE: The device path varies by Process Hacker version:
 *   v2.x → \\\\.\\KProcessHacker2
 *   v3.x → \\\\.\\KProcessHacker3
 *
 * Official source: https://processhacker.sourceforge.io/
 */

import type { ByovdDriverDef } from '../types';

export const KProcessHacker: ByovdDriverDef = {
  name: 'KProcessHacker',
  version: '2.8.0.0',
  downloadUrl: 'https://processhacker.sourceforge.io/downloads.php',
  serviceName: 'KProcessHacker',
  devicePath: '\\\\.\\KProcessHacker2',
  binaryPath: 'C:\\Windows\\System32\\drivers\\KProcessHacker.sys',
  ioctlReadMemory: 0x222400,
  ioctlWriteMemory: 0x222404,
  capabilities: ['read', 'write', 'protect'],
  // SHA-256 of Process Hacker 2.7 signed by Wen Jia Liu (DigiCert).
  // NOTE: Hash varies by version — this is for v2.7. Verify against YOUR binary.
  // v2.8 hash TBD — TODO: verify from official Process Hacker 2.8 release.
  sha256: '2269f6117274297a63e149c6dac51bc3780fd1f64b111f5fa535e1d5718ebccf',
  cve: [],
  status: 'untested',
  physicalMemory: false,
  description:
    'Process Hacker kernel driver (kprocesshacker.sys) exposes ' +
    'virtual memory R/W and process manipulation through its IOCTL ' +
    'interface.  Digitally signed, loads with DSE enabled.  Status ' +
    'untested — IOCTL codes are approximate and require reverse ' +
    'engineering validation.',
};
