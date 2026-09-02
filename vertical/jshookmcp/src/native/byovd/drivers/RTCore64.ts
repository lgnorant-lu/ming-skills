/**
 * RTCore64.sys driver definition (MSI Afterburner).
 *
 * CVE-2019-16098, CVE-2022-22077, CVE-2024-1443, CVE-2024-1460, CVE-2024-3745.
 *
 * This is the most well-known BYOVD driver.  It exposes arbitrary physical
 * memory R/W through MmMapIoSpace with zero access checks.
 *
 * BLOCKED by Microsoft's vulnerable driver blocklist since 2024-2025 on
 * HVCI-enabled systems.  Still loadable on systems with HVCI disabled or
 * on older Windows builds that predate the blocklist update.
 *
 * Reference implementation — provided for completeness even though it
 * is likely blocked on modern, patched systems.
 *
 * Official source: MSI Afterburner installer bundles RTCore64.sys.
 */

import type { ByovdDriverDef } from '../types';

export const RTCore64: ByovdDriverDef = {
  name: 'RTCore64',
  version: '1.0.0.0',
  downloadUrl: 'https://www.msi.com/Landing/afterburner/graphics-cards',
  serviceName: 'RTCore64',
  devicePath: '\\\\.\\RTCore64',
  binaryPath: 'C:\\Windows\\System32\\drivers\\RTCore64.sys',
  ioctlReadMemory: 0x80002048,
  ioctlWriteMemory: 0x8000204c,
  ioctlReadMsr: 0x80002050,
  ioctlWriteMsr: 0x80002054,
  capabilities: ['read', 'write', 'physical'],
  // SHA-256 of MSI-signed RTCore64.sys (GIGABYTE/Aorus variant, well-known BYOVD).
  // Source: LOLDrivers / EDRSandblast project.
  // NOTE: Multiple signed variants exist — verify hash against YOUR specific binary.
  sha256: '01aa278b07b58dc46c84bd0b1b5c8e9ee4e62ea0bf7a695862444af32e87f1fd',
  cve: ['CVE-2019-16098', 'CVE-2022-22077', 'CVE-2024-1443', 'CVE-2024-1460', 'CVE-2024-3745'],
  status: 'blocklisted',
  physicalMemory: true,
  description:
    'MSI Afterburner RTCore64.sys exposes arbitrary physical memory ' +
    'read/write via MmMapIoSpace through IOCTLs 0x80002048/0x8000204c ' +
    'with no access control.  Exploited in-the-wild by BlackByte ' +
    'ransomware to disable EDR callbacks.  Blocked by Microsoft HVCI ' +
    'driver blocklist since 2024.',
};
