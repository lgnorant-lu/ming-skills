# env-patch workbench: {PROJECT_NAME}

Auto-scaffolded by `mcp__reverse-skill__env_patch_scaffold`. Implements
SKILL.md **Rule 34** Phase 4 workflow:

```
sample → extract signer → write stub → vm.runInContext → byte-byte verify → translate to pure algo
            (Step 1)       (Step 2)      (Step 3)         (Step 4)            (Step 5)
```

## Layout

```
{PROJECT_NAME}/
├── package.json
├── runner.js              # vm.runInContext sandbox; exposes sign()
├── verify.js              # samples.json byte-byte compare + first-divergence
├── env_diff.js            # diff browser-env.json vs current stub.js
├── stub.js                # MINIMAL env, expand only on demand
└── config/
    ├── sign-source.js     # extracted signing code (you fill this)
    ├── samples.json       # browser-capture {input, expected} pairs
    └── browser-env.json   # produced by env_diff_snippet pasted in browser
```

## Workflow

### 1. Fill `config/sign-source.js`
Paste the extracted signer + its closure deps. Must end with
`window.__sign__ = <fn>`.

### 2. Capture browser truth → `config/samples.json`
For each test case, capture from Network panel the exact input the
signer received AND the exact headers/body it produced. Replace
placeholders.

### 3. `npm run sign`
First failure tells you which env field your stub lacks. Add it to
`stub.js`. Repeat until it returns a value at all.

### 4. `npm run verify`
Byte-byte compare. Look at `first_divergence_at` — the failure is
almost always: wrong UA, missing localStorage key, wrong timestamp
unit (ms vs s), missing `b1`/`dsllt`-style storage key. NOT the
signer code itself.

### 5. Save env probe → `config/browser-env.json`
In browser console paste the snippet from
`mcp__reverse-skill__env_diff_snippet` → copy result into the file →
`npm run diff` to see what your stub still misses. Add ONLY keys
that env_patch_minimize confirms the signer reads.

### 6. Translate to Python (optional / pure algo)
Once verify is all-green, you've established the baseline. Run
`hooks/property_access_hook.js` in the browser to see which env
reads were trivial constants — those become hard-coded values in
the Python port. The reads that depend on input are the actual
algorithm.

## Red lines

- **Rule 2**: must run inside `node:slim` Docker container 24h. No
  jsdom unless absolutely required, no Playwright EVER.
- **Rule 3**: `acw_tc`/`websectiga` style runtime cookies must be
  re-signed every call; do not hard-code them.
- **Rule 9**: stub.js is `git diff` of "what JSVMP actually read",
  not a full DOM emulator.
