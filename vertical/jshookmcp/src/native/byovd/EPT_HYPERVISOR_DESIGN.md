# EPT Hypervisor Architecture for jshookmcp

> Status: DESIGN — reference architecture for future implementation  
> Estimated effort: 6-12 months (2 engineers)  
> Dependencies: Intel VT-x/AMD-V, BYOVD kernel driver, no Hyper-V/VBS/HVCI

---

## 1. Overview

An EPT-based Type-2 hypervisor (ring -1 / "blue pill" pattern) that virtualizes an already-running Windows OS. It provides the ultimate stealth layer for security research and reverse engineering:

- **Memory split-view**: execute view != read view — injected shellcode is invisible to integrity checks
- **Stealth debug registers**: never touch DR0-DR3 — use EPT execute-only violations as hardware breakpoints
- **VM-exit interposition**: trap CPUID, RDTSC, MSR reads/writes to hide hypervisor presence
- **Ring -1 privilege**: invisible to ALL ring-0 detection, including kernel callbacks and PatchGuard

This document describes the architecture, component design, anti-detection countermeasures, and implementation roadmap. It does NOT contain functional code — see `VmxConstants.ts` for the reference constant definitions that will be used by the implementation.

---

## 2. Prerequisites

### Hardware
- Intel CPU with VT-x + EPT (Nehalem or later for basic EPT; Haswell or later for full feature set)
- AMD CPU with AMD-V + NPT (Bulldozer or later)
- VMX/SVM unlocked in BIOS (Intel VMX → BIOS "Intel Virtualization Technology")
- IOMMU/VT-d disabled (optional — reduces complexity, but some anti-cheats check)

### Software Exclusion
The following features are INCOMPATIBLE and MUST be disabled:

| Feature | Reason | How to Disable |
|---------|--------|---------------|
| Hyper-V | Uses VMX — only one hypervisor can own VMX at a time | `bcdedit /set hypervisorlaunchtype off` |
| WSL2 | Runs on Hyper-V | Disable Hyper-V first, then use WSL1 |
| VBS (Virtualization-Based Security) | Hyper-V partition | Disable via Group Policy or registry |
| HVCI (Hypervisor-Enforced Code Integrity) | VBS feature | Disable in Windows Security → Device Security → Core Isolation |
| Credential Guard | VBS feature | Disable via Group Policy |
| Windows Sandbox | Hyper-V based | Disable in Windows Features |
| Application Guard | Hyper-V based | Disable in Windows Features |

**Verification command** (elevated):
```
systeminfo | findstr /C:"Virtualization-based security"
```
Should show "Not enabled".

### Software Requirements
- Administrator privileges
- EV-signed kernel driver OR loaded BYOVD driver (for `__vmx_on` in ring-0)
- Windows 10/11 x64 (build 19041+)

---

## 3. Component Architecture

```
+------------------------------------------------------------------+
|                          RING 3 (User Mode)                       |
|  +--------------------------------------------------------------+|
|  |  koffi FFI Layer                                              ||
|  |  - ioctl to kernel driver                                     ||
|  |  - structured VM-exit log reader                              ||
|  |  - EPT page table management commands                         ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
        | IOCTL (DeviceIoControl)
        v
+------------------------------------------------------------------+
|                          RING 0 (Kernel Mode)                     |
|  +------------------+  +---------------------------------------+  |
|  | VMXON Manager    |  | EPT Manager                           |  |
|  | - Allocate VMXON  |  | - Allocate EPT PML4                  |  |
|  |   region          |  | - Build page tables                  |  |
|  | - Per-LP VMCS     |  | - Split-view remapping               |  |
|  | - Host/guest      |  | - EPT violation handler              |  |
|  |   state setup     |  | - INVEPT invalidation                |  |
|  +------------------+  +---------------------------------------+  |
|  +------------------+  +---------------------------------------+  |
|  | VM-Exit Handler  |  | Anti-Detection Module                 |  |
|  | - CPUID spoof     |  | - Timing attack mitigation            |  |
|  | - RDTSC/TSC       |  | - Hypervisor presence concealment     |  |
|  |   manipulation    |  | - CPUID leaf filtering                |  |
|  | - MSR interpose   |  | - MSR access pattern obfuscation      |  |
|  | - EPT violation   |  +---------------------------------------+  |
|  |   dispatch        |                                           |  |
|  +------------------+                                           |  |
+------------------------------------------------------------------+
        | VMLAUNCH / VMRESUME
        v
+------------------------------------------------------------------+
|                         RING -1 (VMX Non-Root)                   |
|  +--------------------------------------------------------------+|
|  |  Virtualized Guest OS                                         ||
|  |  - All guest code runs here                                   ||
|  |  - EPT controls physical memory access                        ||
|  |  - VM-exits on specified conditions                           ||
|  |  - Invisible to guest ring-0 (PatchGuard, anti-cheat drivers) ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
```

---

## 4. Component Details

### 4.1 VMXON Manager

**Purpose**: Allocate VMXON region and per-logical-processor VMCS regions, check VMX capability MSRs, and transition the CPU into VMX root operation.

**Key operations**:
1. Read `IA32_VMX_BASIC` MSR → get VMCS revision ID and region size
2. Read `IA32_VMX_CR0_FIXED0` / `IA32_VMX_CR0_FIXED1` → ensure CR0 meets VMX requirements
3. Read `IA32_VMX_CR4_FIXED0` / `IA32_VMX_CR4_FIXED1` → ensure CR4.VMXE (bit 13) is set
4. Allocate non-paged kernel memory for VMXON region (per logical processor)
5. Write VMCS revision ID to VMXON region
6. Execute `VMXON` instruction with physical address of VMXON region
7. For each logical processor:
   - Allocate VMCS region (size from `IA32_VMX_BASIC`)
   - Execute `VMCLEAR` on the region
   - Execute `VMPTRLD` to make it the current VMCS
   - Configure VMCS fields (host/guest state, control fields, EPT pointer)
8. Execute `VMLAUNCH` to enter VMX non-root (guest) mode

**VMCS Configuration Summary**:

| Category | Fields Configured |
|----------|------------------|
| Guest state | CR0, CR3, CR4, DR7, RSP, RIP, RFLAGS, CS/DS/ES/SS/FS/GS, GDTR, IDTR, LDTR, TR, SYSENTER, EFER, PAT |
| Host state | CR0, CR3, CR4, RSP, RIP, CS/DS/ES/SS/FS/GS, GDTR, IDTR, TR, SYSENTER, EFER, PAT |
| Control — pin-based | External-interrupt exiting, NMI exiting, Virtual NMI |
| Control — primary proc-based | Use TSC offsetting, HLT exiting, RDTSC exiting, MOV-DR exiting, MSR bitmaps, activate secondary controls |
| Control — secondary proc-based | Enable EPT, Enable VPID, RDTSCP, Unrestricted guest, Desc-table exiting, WBINVD exiting, Mode-based execute for EPT, XSAVES/XRSTORS |
| Control — VM-exit | Save debug controls, Host address-space size, Save/load EFER, Save/load PAT |
| Control — VM-entry | Load debug controls, IA-32e mode guest, Load EFER, Load PAT |
| EPT | EPT pointer (PML4 physical address), EPTP list address (if multiple) |

### 4.2 EPT Manager

**Purpose**: Create and manage Extended Page Tables that provide split-view memory (execute vs read/write) and hardware-stealth breakpoints.

**EPT Page Table Structure** (4-level, 48-bit guest-physical address):
```
Guest-Physical Address (48 bits)
| 47:39 | 38:30 | 29:21 | 20:12 | 11:0 |
| PML4  | PDPT  |  PD   |  PT   | offset|
```

**EPT Entry Permission Bits** (per-entry):
- Bit 0: Read access
- Bit 1: Write access  
- Bit 2: Execute access (0 = instruction fetch causes EPT violation)
- Bit 10: Execute access for user-mode (for mode-based execute control)

**Split-View Implementation**:

```
Goal: Inject shellcode at GPA 0x12345000 such that:
  - Execute view: shows our shellcode bytes
  - Read view: shows the original bytes (so integrity checks pass)

Implementation:
  1. Original page (physAddr=0xA): [original code bytes]
  2. Alias page (physAddr=0xB): [our shellcode bytes]
  3. EPT PTE for GPA 0x12345000:
     - Set physAddr = 0xB
     - Set read=0, write=0, execute=1  (execute view → alias)
  4. EPT violation handler:
     - On data read/write to 0x12345000:
       - Temporarily set physAddr = 0xA, read=1, write=1
       - Set MTF (Monitor Trap Flag) to restore on next instruction
     - Next VM-exit (MTF):
       - Restore physAddr = 0xB, read=0, write=0, execute=1
```

**EPT-Based Hardware Breakpoints** (never touch DR0-DR3):

```
Goal: Break when code at GPA 0x12345000 executes.

Implementation:
  1. Set EPT PTE for GPA 0x12345000:
     - execute=0 (instruction fetch → EPT violation)
     - read=1, write=1 (data access → normal)
  2. On EPT violation with qualification.instruction_fetch=1:
     - Save guest state (RIP, registers)
     - Notify user-mode debugger
     - Single-step: set execute=1 + MTF
     - On MTF VM-exit: restore execute=0
```

**Memory Hiding Subsystem**:

Three protection modes per page:

| Mode | Read View | Write View | Execute View | Use Case |
|------|-----------|------------|-------------|----------|
| Normal | Original | Original | Original | Default for all pages |
| Hidden Read | Modified | Modified | Original | Data-only modifications invisible to reads |
| Hidden Execute | Original | Original | Modified | Shellcode invisible to integrity checks |
| Full Hidden | Modified | Modified | Modified | Full redirection (most detectable) |

### 4.3 VM-Exit Handler

**Purpose**: Handle all VM-exits, dispatch to appropriate sub-handlers, and return to the guest.

**Exit Dispatch Table**:

| VM-Exit Reason | Handler | Purpose |
|---------------|---------|---------|
| 0 (Exception/NMI) | `handleException` | Forward #BP/#DB to guest or interpose |
| 10 (CPUID) | `handleCpuid` | Spoof hypervisor leaves, filter feature bits |
| 12 (HLT) | `handleHlt` | Idle loop optimization |
| 16 (RDTSC) | `handleRdtsc` | TSC offset to hide VM-exit overhead |
| 28 (CR Access) | `handleCrAccess` | Shadow CR0/CR4 for stealth |
| 29 (DR Access) | `handleDrAccess` | Virtualize DR0-DR3, DR7 |
| 31 (MSR Read) | `handleMsrRead` | Interpose MSR reads (EFER, STAR, LSTAR, etc.) |
| 32 (MSR Write) | `handleMsrWrite` | Interpose MSR writes |
| 48 (EPT Violation) | `handleEptViolation` | Split-view switching, stealth breakpoints |
| 49 (EPT Misconfig) | `handleEptMisconfig` | Log and fix misconfigured EPT entries |
| 51 (RDTSCP) | `handleRdtscp` | TSC offset + AUX preservation |
| 52 (Preemption Timer) | `handlePreemptionTimer` | Time-slice management |
| 54 (WBINVD) | `handleWbinvd` | Cache management for split-view |
| 57 (RDRAND) | `handleRdrand` | Entropy source passthrough or spoofing |

**CPUID Spoofing Logic**:

```
CPUID.0x40000000 (Hypervisor leaf):
  - Return all zeros → hides hypervisor presence from standard detection

CPUID.0x00000001 (Feature info):
  - Clear bit 31 in ECX → hide hypervisor presence bit
  - For specific anti-cheats: return modified feature set matching bare metal

CPUID leaf cache:
  - Cache standard leaf values from pre-VMX measurement
  - Return cached values for non-intercepted leaves
```

**RDTSC/RDTSCP Handling**:

```
RDTSC:
  - Add TSC_OFFSET from VMCS
  - Add per-VM-exit offset to compensate for exit latency
  - Result: guest sees TSC that appears continuous

Anti-timing-detection:
  - Measure and track cumulative VM-exit overhead
  - Distribute offset change across multiple RDTSC returns
  - Randomize VM-exit timing slightly (jitter)
```

### 4.4 Anti-Detection Module

**Purpose**: Prevent the guest (and any anti-cheat drivers) from detecting the hypervisor.

**Known Anti-Hypervisor Detections and Countermeasures**:

| # | Detection | Method | Countermeasure |
|---|-----------|--------|---------------|
| 1 | CPUID hypervisor leaf | `CPUID.0x40000000` | Trap and return zeros |
| 2 | CPUID.1.ECX[31] | Check hypervisor bit | Clear bit 31, return cached pre-VMX value |
| 3 | RDTSC timing | Measure `RDTSC; RDTSC` delta | TSC offset + cumulative VM-exit compensation |
| 4 | VMCS shadowing | `VMREAD` of LINK_POINTER for nested virtualization | Nested VMX (VT-x in VMX non-root) — Phase 3 |
| 5 | L1 Terminal Fault | L1TF vulnerability check | EPT present bit manipulation on affected CPUs |
| 6 | MSR_LSTAR scan | Read IA32_LSTAR to detect hooking | Return cached pre-VMX value on MSR read |
| 7 | IDT base scan | SGDT → check if IDT base is outside expected kernel range | Return pre-VMX GDTR/IDTR on SGDT/SIDT |
| 8 | CPUID_DTS feature | CPUID.1.ECX[6] debug store feature bit | Virtualize CPUID.1.ECX to clear DTS bit |
| 9 | #VE (Virtualization Exception) | EPT-violation #VE delivery pattern analysis | Use VM-exit (#VMEXIT) instead of #VE for critical pages |
| 10 | INVD instruction | Cache invalidation without VM-exit | Force WBINVD exiting, emulate INVD |
| 11 | Performance counters | Read PMU counters to detect extra cycles | Interpose IA32_PERF_GLOBAL_CTRL MSR if counters show anomaly |
| 12 | APIC timer deviation | Compare LAPIC timer to TSC | Interpose APIC timer MMIO if deviation exceeds threshold |
| 13 | CR3 target count | Detect VMCS CR3-target-count used for process switching | Use EPT-based process tracking instead of CR3 targets |

**Timing Attack Mitigations**:

```
Problem: Anti-cheat measures time between RDTSC instructions.
  If VM-exits happen between them, the delta is abnormally large.

Solution:
  1. Track cumulative VM-exit time per VM-entry
  2. On RDTSC: return TSC + TSC_OFFSET + cumulative_overhead
  3. On VM-exit: add exit_latency to cumulative_overhead
  4. On periodic timer: distribute overhead gradually across future RDTSC returns
  5. Add small random jitter to mask any remaining pattern
```

---

## 5. EPT Split-View Deep Dive

### 5.1 Page Table Allocation

```
EPT PML4 Table (4KB, 512 entries)
  └─ EPT PDPT (4KB, 512 entries)
       └─ EPT PD (4KB, 512 entries)
            └─ EPT PT (4KB, 512 entries, each covers 4KB)
                 └─ 4KB Guest-Physical Page

Total memory for identity-mapping 128MB: ~320KB
Total memory for identity-mapping 4GB: ~8MB
```

### 5.2 Split-View Workflow

```
1. ALLOCATE:
   - Allocate two physical pages: ORIGINAL (guest's real page) and ALIAS (our modified page)
   - Copy ORIGINAL contents to ALIAS
   - Write shellcode/modifications to ALIAS

2. CONFIGURE EPT:
   - EPT PTE for target GPA: physAddr=ALIAS, read=0, write=0, execute=1
   - Data accesses (read/write) see ORIGINAL via violation handler
   - Instruction fetches see ALIAS directly (no violation)

3. HANDLE EPT VIOLATION (data read/write):
   - EPT violation fires with qualification: data_read=1 or data_write=1
   - Temporarily set PTE: physAddr=ORIGINAL, read=1, write=1, execute=1
   - Set MTF (Monitor Trap Flag) to fire after next instruction
   - Resume guest → guest reads/writes original data

4. HANDLE MTF VM-EXIT:
   - Restore PTE: physAddr=ALIAS, read=0, write=0, execute=1
   - Resume guest → next instruction fetch sees shellcode
```

### 5.3 Multi-Page Split-View

For shellcode larger than 4KB (spanning multiple pages):
- Maintain a range table: `{gpa_start, gpa_end, original_page_list, alias_page_list}`
- On EPT violation, look up the GPA in the range table
- Apply split-view logic to the specific page

---

## 6. Implementation Roadmap

### Phase 1 — Foundation (Month 1-2)

**Goal**: VMXON, VMCS setup, basic VM-exit handler, CPUID spoofing.

Deliverables:
- [ ] `VmxManager`: Allocate VMXON/VMCS regions, read capability MSRs, validate VMX support
- [ ] `VmcsConfig`: Configure all mandatory VMCS fields (host/guest state, control fields)
- [ ] `VmxEntry`: VMLAUNCH and VMRESUME sequences
- [ ] `VmExitDispatcher`: Router for exit reasons → handler functions
- [ ] `CpuidHandler`: Spoof hypervisor leaf, filter feature bits
- [ ] `BasicVmExitHandlers`: HLT, RDTSC (basic offset), CR access (basic shadow)
- [ ] `VmxTracer`: Structured VM-exit log for debugging

Tests:
- [ ] VMCS field read-back verification (VMCLEAR → VMWRITE → VMREAD)
- [ ] CPUID spoofing verification (compare pre/post VMX guest CPUID values)
- [ ] Basic VM-entry/VM-exit round-trip (no guest crash for 60+ seconds)
- [ ] Multi-processor: VMXON on all logical processors

### Phase 2 — EPT Foundation (Month 3-4)

**Goal**: EPT page tables, identity mapping, split-view for single pages.

Deliverables:
- [ ] `EptManager`: PML4 allocation, 4-level page table builder
- [ ] `EptIdentityMap`: Identity-map guest-physical to host-physical (all guest memory)
- [ ] `EptSplitView`: Dual-page (ORIGINAL + ALIAS) setup
- [ ] `EptViolationHandler`: Parse exit qualification, dispatch to split-view logic
- [ ] `MtfHandler`: MTF VM-exit for temporary view switching
- [ ] `InveptWrapper`: INVEPT for single-context and all-contexts invalidation

Tests:
- [ ] EPT identity map: guest accesses all memory regions without violation
- [ ] Split-view single page: read sees ORIGINAL, execute sees ALIAS
- [ ] Split-view invalidation: INVEPT + re-execute → views restore correctly
- [ ] Multi-page split-view: contiguous range > 4KB

### Phase 3 — Stealth Hardening (Month 5-8)

**Goal**: Debug register virtualization, stealth breakpoints, anti-detection.

Deliverables:
- [ ] `DrVirtualization`: MOV-DR exiting handler → virtual DR0-DR7
- [ ] `EptBreakpoint`: EPT execute-only violations as hardware breakpoints
- [ ] `TimingMitigation`: TSC offset management, cumulative overhead tracking
- [ ] `AntiDetectionSuite`: All 13 anti-detection countermeasures (see Section 4.4)
- [ ] `NestedVmx`: VT-x in VMX non-root (for VMCS-shadowing detection bypass)
- [ ] `MsrInterpose`: Full MSR read/write bitmap management

Tests:
- [ ] DR breakpoint: set virtual DR0, execute breakpoint address, verify #DB
- [ ] EPT breakpoint: set execute-only on page, execute code, verify violation
- [ ] Anti-CPUID: scan all CPUID leaves for hypervisor indicators → 0 findings
- [ ] Anti-TSC: measure TSC delta across 10K VM-exits → within 1% of bare metal
- [ ] Anti-SGDT/SIDT: verify returned values match pre-VMX measurement

### Phase 4 — Production Hardening (Month 9-12)

**Goal**: Full anti-detection suite, production stability, multi-version support.

Deliverables:
- [ ] `WindowsVersionMatrix`: Verified support matrix for Win10 22H2, Win11 23H2/24H2
- [ ] `CrashRecovery`: VMX abort handler, automatic cleanup on triple-fault
- [ ] `PerformanceProfiling`: Measure and optimize VM-exit frequency and latency
- [ ] `KnownAntiCheatTests`: Verify against EAC, BattlEye, Vanguard (offline/lab)
- [ ] `Documentation`: Operator manual, known limitations, troubleshooting guide
- [ ] `Uninstaller`: Safe hypervisor teardown (VMXOFF sequence per LP, memory cleanup)

Tests:
- [ ] 24-hour stability: continuous VMX operation with no crash or memory leak
- [ ] Anti-cheat compatibility: EAC/BattlEye/Vanguard do not detect hypervisor (lab environment)
- [ ] Hot-unload: VMXOFF + driver unload without BSOD
- [ ] Multi-processor stress: all LPs handling VM-exits concurrently

---

## 7. Known Limitations

1. **Windows only**: No Linux/macOS host support in initial scope (VT-x is per-OS)
2. **No nested virtualization**: Cannot run inside another hypervisor (VMware, VirtualBox, KVM)
3. **PCIe passthrough not supported**: DMA attacks from PCIe devices can bypass EPT
4. **SMM not intercepted**: System Management Mode (ring -2) is below VMX root
5. **AMD-V variant**: Initial implementation targets Intel VT-x; AMD-V requires separate VMCS/VMCB management
6. **Intel PT (Processor Trace)**: Anti-cheats may use Intel PT for execution flow analysis — requires PT virtualization (complex)
7. **No live migration**: Hypervisor state cannot be migrated between machines

---

## 8. References

### Intel Documentation
- Intel SDM Volume 3C, Chapters 24-28: VMX Architecture
- Intel SDM Volume 3C, Chapter 29: EPT (Extended Page Tables)
- Intel SDM Volume 4: MSR Reference

### Reference Implementations
- **HyperPlatform** (tandasat): https://github.com/tandasat/HyperPlatform — Clean VT-x hypervisor reference
- **DdiMon** (tandasat): https://github.com/tandasat/DdiMon — EPT-based stealth hooking
- **SimpleSvm** (tandasat): https://github.com/tandasat/SimpleSvm — AMD-V reference
- **hvpp** (wbenny): https://github.com/wbenny/hvpp — C++17 VT-x library with clean abstractions
- **Gbhv** (Gbps): https://github.com/Gbps/gbhv — EPT-based hypervisor with split-view
- **bareflank/hypervisor**: https://github.com/Bareflank/hypervisor — Cross-platform hypervisor framework

### Research Papers
- "Bridging the Semantic Gap through EPT Violation #VE" — Intel Whitepaper
- "Subverting Windows Kernel Security with an EPT-based Hypervisor" — Recon 2019
- "L1 Terminal Fault: OS/SMM Derivation through Virtualization" — Bitdefender

### Related CVEs
- CVE-2018-3615 (L1 Terminal Fault — VT-x)
- CVE-2018-3620 (L1 Terminal Fault — OS/SMM)
- CVE-2018-3646 (L1 Terminal Fault — VMM)

---

## Appendix A: VM-Exit Round-Trip Latency Budget

| Operation | Approximate Cycles | Notes |
|-----------|-------------------|-------|
| VM-exit (hardware) | 300-500 | Depends on CPU generation |
| Save guest state to VMCS | Included in VM-exit | |
| Load host state from VMCS | Included in VM-exit | |
| C handler entry | 50-100 | Function call overhead |
| VM-exit reason decode | 10-20 | Switch statement |
| Handler logic | Variable | EPT violation: ~200; CPUID: ~50 |
| VMRESUME + VM-entry | 300-500 | Depends on CPU generation |
| **Total per VM-exit** | **~800-1200** | Before optimization |

For comparison:
- EPT violation data read: ~1200 cycles total
- EPT violation code exec (stealth BP): ~1200 cycles per hit
- Existing DR-based HW breakpoint: ~0 cycles (no VM-exit)
- Software breakpoint (INT3): ~500 cycles

The key optimization target is reducing the EPT-violation frequency for split-view pages to only the necessary operations (read/write, not every instruction fetch).

---

## Appendix B: EPT Violation Statistics (Expected)

For a typical game process with split-view on:
- 1 injected DLL (~200KB, 50 pages)
- 3 stealth breakpoints (3 pages)

Expected VM-exit rates during gameplay:
- EPT violations (data access to hidden pages): ~100-500/sec (read/write to injected code pages)
- MTF VM-exits (post-violation restore): same as violations
- RDTSC/RDTSCP VM-exits: ~1000-5000/sec (if TSC virtualization is needed)
- CPUID VM-exits: ~10/sec
- MSR VM-exits: ~50-100/sec

Total: ~2000-10000 VM-exits/sec
Overhead: ~0.2-1% of CPU time (on modern CPUs)
