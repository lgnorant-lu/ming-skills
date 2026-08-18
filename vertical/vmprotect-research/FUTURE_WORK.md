# Future Work: VMP 3.7+ Support (Merged Handlers)

## Current Status

**Supported:** VMP 1.x, 2.x, 3.x (≤3.6) — 22/22 samples validated (100%)
**Blocked:** VMP 3.7+ (merged handlers) — requires reverse engineering

## Known Limitation: Merged Handlers (VMP 3.7+)

### What Changed in VMP 3.7+

VMP 3.7 introduced **merged handlers** — a structural change where multiple VM operations are combined into single handler entries. This breaks current classifier assumptions:

**VMP ≤3.6 (per-handler model):**
```
Handler entry pattern: 49 8b 2a (POP r10, [r10])
Each handler = one semantic operation (ADD, SUB, LOAD, etc.)
Classifier: Match entry pattern → extract core op → classify
```

**VMP 3.7+ (merged handler model):**
```
Handler entry pattern: still 49 8b 2a but...
Single handler may contain: LOAD + ADD + STORE (3 ops merged)
Classifier: Pattern matching fails → unknown handler type
```

### Why Current Classifier Fails

1. **Entry pattern ambiguity:** Multiple merged ops share same entry pattern
2. **Operation extraction:** Can't isolate individual ops from merged handler
3. **Semantic mapping:** Handler semantics no longer 1:1 with x86 instructions

### Impact

- Dispatch table extraction: ✅ Still works (XOR key capture unchanged)
- Handler classification: ❌ Fails (can't identify merged handler types)
- Bytecode decoding: ❌ Blocked (needs correct handler semantics)

## Path to VMP 3.7+ Support

### Phase 1: Obtain Sample (Blocker)

Need actual VMP 3.7+ protected binary:
- **Sources:** VirusTotal (API key), MalwareBazaar, Discord RE communities
- **Known families:** SystemBC, RisePro, PrivateLoader, Qbot (all use 3.7+)
- **Alternative:** Protect test binary with VMP 3.7+ demo (requires Windows GUI)

**Status (2026-06-01):** Created VMP 3.10.5 test binary via console tool. Static analysis fails (packed/encrypted dispatch table). Requires runtime unpacking or dynamic analysis approach.

### Phase 2: Reverse Engineer Merged Handler Structure

With sample in hand:

1. **Disassemble handlers** (Capstone/Ghidra)
   - Identify merged handler boundaries
   - Extract individual operations within merge
   - Map operation sequences to x86 semantics

2. **Build merged handler database**
   - Document all merged handler types
   - Map merged patterns → operation chains
   - Create lookup table (similar to current handler_classification.json)

3. **Update classifier logic**
   ```rust
   // Pseudocode
   fn classify_merged_handler(handler_bytes: &[u8]) -> Vec<Operation> {
       // Instead of: pattern → single op
       // Now: pattern → [op1, op2, op3, ...]
       
       // Detect merge boundaries (e.g., via stack frame analysis)
       let ops = extract_merged_operations(handler_bytes);
       
       // Classify each operation
       ops.iter().map(|op| classify_operation(op)).collect()
   }
   ```

4. **Extend bytecode decoder**
   - Handle operation chains per handler
   - Reconstruct x86 sequences from merged ops
   - Validate against real trace data

### Phase 3: Validation

- Test on 3.7+ sample set (need ≥5 samples for coverage)
- Verify bytecode reconstruction matches expected x86
- Benchmark performance (merged handlers may be slower to decode)

## Technical Challenges

| Challenge | Mitigation |
|-----------|-----------|
| **Merged op boundaries unclear** | Use stack frame analysis + pattern matching |
| **Operation semantics complex** | Cross-reference with VMP 3.5.1 leak (if available for 3.7+) |
| **No public 3.7+ source leak** | Reverse engineer from binaries only |
| **Merged handlers vary per binary** | Build adaptive classifier (learn from trace data) |

## Estimated Effort

- **Phase 1 (sample acquisition):** 1-2 weeks (depends on community help)
- **Phase 2 (reverse engineering):** 2-4 weeks (per-handler analysis)
- **Phase 3 (validation):** 1 week (testing + refinement)

**Total:** 4-7 weeks with sample in hand

## How to Contribute

If you have:
1. **VMP 3.7+ protected binary** → Submit as GitHub issue with hash
2. **Merged handler analysis** → Share findings in discussions
3. **Trace data from 3.7+ binary** → Attach to issue for reference

## References

- VMP 3.5.1 source leak: `/home/ciupix/RE/culmaster/vmprotect-3.5.1-leak/`
- Current handler classifier: `src/handler_classifier.rs`
- Dispatch table extractor: `src/dispatch_table.rs`
- Bytecode decoder: `src/bytecode.rs`

## Status

**Last Updated:** 2026-06-01
**Blocker:** VMP 3.7+ sample acquisition
**Next Action:** Community contribution or automated sample hunting
