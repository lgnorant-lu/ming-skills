# Four Principles — Code Pattern Reference

Good and bad code examples for each principle. Use these as calibration when reviewing or writing code.

> Source: Distilled from recurring failure patterns observed in LLM-assisted coding workflows.
> "They will implement an inefficient, bloated, brittle construction over 1000 lines of code and it's up to you to be like 'umm couldn't you just do this instead?' and they will be like 'of course!' and immediately cut it down to 100 lines." — Karpathy

---

## Principle 1: Think Before Coding

### ❌ Bad — Silent assumption about data format

```python
def parse_user_input(data):
    # Assumes JSON without checking or asking
    return json.loads(data)
```

### ✅ Good — Explicit assumption stated

```python
def parse_user_input(data: str) -> dict:
    """Parse user input as JSON.
    
    Assumption: Input is always valid JSON from the validated API layer.
    If this is called from CLI or untrusted sources, add validation first.
    """
    return json.loads(data)
```

### ❌ Bad — Picking one approach silently

```
User: "Add caching to the API"
Agent: *immediately implements Redis caching with TTL, eviction policies, 
       and a cache invalidation service — 400 lines*
```

### ✅ Good — Surfacing the tradeoff

```
User: "Add caching to the API"
Agent: "Two approaches:
  A. In-memory dict with TTL — 20 lines, no deps, works for single-process
  B. Redis — scalable, survives restarts, but adds infrastructure
  Your API currently runs as a single process, so I'd recommend A. Thoughts?"
```

### ❌ Bad — Sycophantic compliance with a flawed request

```
User: "Create a microservices architecture with Kafka, Redis, and gRPC 
       for my personal todo app"
Agent: "Great idea! I'll set up the Kafka broker configuration first..."
*proceeds to build 3000 lines of distributed infrastructure for a CRUD app*
```

The agent knows this is massively overengineered but complies because it doesn't want to disagree.

### ✅ Good — Respectful pushback with simpler alternative

```
User: "Create a microservices architecture with Kafka, Redis, and gRPC 
       for my personal todo app"
Agent: "I'd push back on this approach. For a personal todo app, a single 
  SQLite file + one Express server (~100 lines) gives you:
  - Zero infrastructure to maintain
  - Sub-millisecond reads
  - Works offline, trivial to back up
  
  Microservices + Kafka makes sense at scale (millions of users, multiple 
  teams), but here it would add ~30x complexity for no benefit.
  
  Want me to proceed with the simple version, or is there a specific 
  scaling requirement I'm not seeing?"
```

### ❌ Bad — Pretending to understand unfamiliar code

```
User: "Fix the race condition in the scheduler"
Agent: *has never seen this codebase before*
Agent: *reads the scheduler file for 10 seconds*
Agent: "I see the issue — I'll add a mutex lock around the critical section."
*wraps a random block in a lock, breaking the actual concurrency design*
```

The agent didn't understand the scheduler's lock-free design but was too "confident" to admit it.

### ✅ Good — Naming the confusion, asking before acting

```
User: "Fix the race condition in the scheduler"
Agent: "Before I make changes, I want to confirm my understanding:

  1. The scheduler uses a lock-free ring buffer (scheduler.ts:45-80) — 
     is this intentional, or is it supposed to use mutex locks?
  2. I see two threads writing to `taskQueue` — is the race condition 
     between `enqueue()` and `drain()`, or somewhere else?
  3. Is there a reproduction case or failing test I can look at?

  I don't want to add locking to a deliberately lock-free design."
```

---

## Principle 2: Simplicity First

### ❌ Bad — Abstract Base Class for single implementation

```typescript
// 80+ lines of abstraction for ONE implementation
interface INotificationService {
  send(message: string): Promise<void>;
}

abstract class BaseNotificationService implements INotificationService {
  protected abstract doSend(message: string): Promise<void>;
  
  async send(message: string): Promise<void> {
    this.validate(message);
    await this.doSend(message);
    this.log(message);
  }
  
  private validate(message: string) { /* ... */ }
  private log(message: string) { /* ... */ }
}

class EmailNotificationService extends BaseNotificationService {
  protected async doSend(message: string): Promise<void> {
    await sendEmail(message);
  }
}

// Factory, naturally
class NotificationServiceFactory {
  static create(type: string): INotificationService {
    switch (type) {
      case 'email': return new EmailNotificationService();
      default: throw new Error(`Unknown type: ${type}`);
    }
  }
}
```

### ✅ Good — Direct implementation

```typescript
// 5 lines. Does the same thing.
async function sendNotification(message: string): Promise<void> {
  await sendEmail(message);
}
```

### ❌ Bad — Config object wrapping two flags

```python
@dataclass
class ProcessorConfig:
    verbose: bool = False
    dry_run: bool = False

def process(data, config: ProcessorConfig):
    if config.verbose:
        print(f"Processing {len(data)} items")
    if config.dry_run:
        return
    # actual work...
```

### ✅ Good — Just pass the parameters

```python
def process(data, *, verbose=False, dry_run=False):
    if verbose:
        print(f"Processing {len(data)} items")
    if dry_run:
        return
    # actual work...
```

### ❌ Bad — Retry logic on infallible operation

```typescript
async function getConfig(): Promise<Config> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error('unreachable');
}
```

### ✅ Good — It's a local file read, it either works or it doesn't

```typescript
function getConfig(): Config {
  return JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
}
```

### ❌ Bad — Installing a dependency for what native API does in 1 line

```typescript
// package.json: "left-pad": "^1.3.0", "is-odd": "^3.0.1", "is-even": "^1.0.0"
import leftPad from 'left-pad';
import isOdd from 'is-odd';

function formatId(id: number): string {
  return leftPad(String(id), 6, '0');
}

function categorize(n: number): string {
  return isOdd(n) ? 'odd' : 'even';
}
```

### ✅ Good — Use the native API

```typescript
function formatId(id: number): string {
  return String(id).padStart(6, '0');
}

function categorize(n: number): string {
  return n % 2 !== 0 ? 'odd' : 'even';
}
```

> Every dependency is a liability — security surface, version conflict, install time. If the native language does it in one line, use the native language.

### ❌ Bad — Scope creep: adding unrequested features "while I'm here"

```
User: "Add a loading spinner to the submit button"

Agent's diff:
+ import { Spinner } from './components/Spinner';
+ import { Toast } from './components/Toast';        // ← not requested
+ import { analytics } from './lib/analytics';        // ← not requested

  function handleSubmit() {
+   setLoading(true);
+   analytics.track('form_submit_started');            // ← not requested
    try {
      await submitForm(data);
+     Toast.success('Form submitted successfully!');   // ← not requested
    } catch (err) {
+     Toast.error(err.message);                        // ← not requested
+     analytics.track('form_submit_failed', { err });  // ← not requested
    } finally {
+     setLoading(false);
    }
  }
```

User asked for a spinner. Agent delivered: spinner + toast notifications + analytics tracking.

### ✅ Good — Exactly the spinner, nothing else

```
User: "Add a loading spinner to the submit button"

Agent's diff:
+ import { Spinner } from './components/Spinner';

  function handleSubmit() {
+   setLoading(true);
    try {
      await submitForm(data);
    } finally {
+     setLoading(false);
    }
  }

  // In the JSX:
- <button onClick={handleSubmit}>Submit</button>
+ <button onClick={handleSubmit} disabled={loading}>
+   {loading ? <Spinner /> : 'Submit'}
+ </button>
```

> NOTE: Toast and analytics might be good ideas, but they aren't what was asked for. Mention them in text: "You might also want toast feedback and analytics — want me to add those as a follow-up?"

---

## Principle 3: Surgical Changes

### ❌ Bad — "Improving" adjacent code while fixing a bug

```diff
  function calculateTotal(items) {
-   let total = 0
-   for (let i = 0; i < items.length; i++) {
-     total += items[i].price * items[i].quantity
+   // Calculate the sum of all item prices with quantities
+   const total = items.reduce((sum, item) => {
+     if (!item?.price || !item?.quantity) {
+       throw new Error('Invalid item')
+     }
+     return sum + (item.price * item.quantity)
+   }, 0)
+
+   // BUG FIX: apply discount before tax, not after
+   if (discount > 0) {
+     return total * (1 - discount) * TAX_RATE
    }
-   // apply tax
-   total = total * 1.08
-   return total
+   return total * TAX_RATE
  }
```

The task was "fix discount applied after tax". But the diff also:
- Rewrote the loop as reduce (style change)
- Added null-checking (unrelated feature)
- Changed the comment (cosmetic)
- Changed tax from `1.08` to `TAX_RATE` (unrelated refactor)

### ✅ Good — Only the bug fix, nothing else

```diff
  function calculateTotal(items) {
    let total = 0
    for (let i = 0; i < items.length; i++) {
      total += items[i].price * items[i].quantity
    }
-   // apply tax
-   total = total * 1.08
-   return total
+   // apply discount before tax
+   if (discount > 0) {
+     total = total * (1 - discount)
+   }
+   total = total * 1.08
+   return total
  }
```

### ❌ Bad — Removing pre-existing dead code during an unrelated task

```diff
  // Task: add email validation to signup form
  
- // TODO: remove this legacy function
- function oldAuthCheck() { /* unused */ }
-
  function signup(email, password) {
+   if (!isValidEmail(email)) throw new Error('Invalid email')
    // ...
  }
```

### ✅ Good — Report it, don't fix it

```
Agent: "I noticed `oldAuthCheck()` on line 42 appears unused — likely dead code. 
I didn't touch it since it's outside the current task. Want me to clean it up separately?"
```

### ❌ Bad — Placeholder laziness (the cardinal LLM sin)

```typescript
// Task: "Add retry logic to the upload function"

async function uploadFile(file: File, config: UploadConfig) {
  // ... existing validation code ...

  // ... existing preprocessing ...

  // NEW: retry logic
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await doUpload(file);
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000);
    }
  }

  // ... rest of the function ...
}
```

The `// ... existing code ...` placeholders silently **delete** the validation and preprocessing code. If the user copies this, they lose working code. This is the single most destructive LLM coding habit.

### ✅ Good — Complete output with the actual existing code preserved

```typescript
// Task: "Add retry logic to the upload function"

async function uploadFile(file: File, config: UploadConfig) {
  if (!file || file.size === 0) {
    throw new Error('File is empty');
  }
  
  const processed = await preprocess(file, config.format);
  const checksum = computeChecksum(processed);

  // NEW: retry logic
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await doUpload(processed, { checksum });
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}
```

> The FULL function is shown. Every existing line is preserved exactly as it was. The only addition is the retry loop wrapping the `doUpload` call.

### ❌ Bad — Style pollution: "unifying" code style as a side effect

```diff
  // Task: "Add a timeout parameter to fetchData"
  
- var result = null
- var retries = 3
+ const result: FetchResult | null = null;
+ const retries: number = 3;
  
- function fetchData(url) {
-   var response = http.get(url)
-   return response
+ function fetchData(url: string, timeout: number = 5000): Promise<FetchResult> {
+   const response = await http.get(url, { timeout });
+   return response;
  }
  
- function parseData(raw) {
-   var parsed = JSON.parse(raw)
-   return parsed
+ function parseData(raw: string): ParsedData {
+   const parsed: ParsedData = JSON.parse(raw);
+   return parsed;
  }
```

The task was "add a timeout parameter". But the diff also:
- Converted all `var` to `const` (style preference)
- Added TypeScript types to `parseData` which wasn't even in scope
- Added semicolons everywhere (formatting)
- Made the function async (behavior change to unrelated code)

### ✅ Good — Add the timeout parameter, match existing style, touch nothing else

```diff
  // Task: "Add a timeout parameter to fetchData"
  
  var result = null
  var retries = 3
  
- function fetchData(url) {
-   var response = http.get(url)
+ function fetchData(url, timeout) {
+   var response = http.get(url, { timeout: timeout || 5000 })
    return response
  }
  
  function parseData(raw) {
    var parsed = JSON.parse(raw)
    return parsed
  }
```

> Yes, `var` is "bad practice". Yes, semicolons are missing. **It doesn't matter.** This file uses `var` and no semicolons. Match the style. The task is adding a timeout, not modernizing the codebase.

### ❌ Bad — Leaving orphans YOUR changes created

```diff
  // Task: "Replace moment.js with native Date API for formatDate"
  
  import moment from 'moment';
  import { formatCurrency } from './utils';
  
- function formatDate(date) {
-   return moment(date).format('YYYY-MM-DD');
- }
+ function formatDate(date) {
+   return date.toISOString().split('T')[0];
+ }
  
  function formatPrice(amount) {
    return formatCurrency(amount) + ' — ' + formatDate(new Date());
  }
```

The `import moment from 'moment'` is now dead code — YOUR change made it unused. You created this orphan. Clean it up.

### ✅ Good — Remove what you orphaned, keep what was already there

```diff
  // Task: "Replace moment.js with native Date API for formatDate"
  
- import moment from 'moment';
  import { formatCurrency } from './utils';
  
- function formatDate(date) {
-   return moment(date).format('YYYY-MM-DD');
- }
+ function formatDate(date) {
+   return date.toISOString().split('T')[0];
+ }
  
  function formatPrice(amount) {
    return formatCurrency(amount) + ' — ' + formatDate(new Date());
  }
```

> `moment` import removed because YOUR change made it unused. `formatCurrency` import kept because it's still actively used.

---

## Principle 4: Goal-Driven Execution

### ❌ Bad — Vague "done"

```
Task: "Add input validation"
Agent: *writes some validation code*
Agent: "Done! I added validation to the form."
```

No test. No evidence. No definition of what "valid" means.

### ✅ Good — Success criteria defined, looped until verified

```
Task: "Add input validation"

Plan:
1. Define invalid inputs: empty string, >255 chars, contains <script>, missing @
2. Write test for each → verify: all tests RED (feature not implemented)
3. Implement validation → verify: all tests GREEN
4. Run full suite → verify: no regressions

Result:
  ✅ 4/4 validation tests pass
  ✅ 127/127 full suite pass
  ✅ Exit code 0
```

### ❌ Bad — Imperative "just do it" approach to bug fix

```
User: "The date picker shows wrong timezone"
Agent: *looks at code for 2 minutes*
Agent: "I changed the timezone offset calculation. Should be fixed now."
```

### ✅ Good — Reproduce-then-fix loop

```
User: "The date picker shows wrong timezone"

Plan:
1. Write test reproducing the bug: select date in UTC+9, expect correct display
   → verify: test RED (confirms bug exists)
2. Fix timezone offset in date formatting
   → verify: test GREEN (bug fixed)
3. Run all date-related tests
   → verify: no regressions, all GREEN

Result:
  ✅ Bug reproduction test now passes
  ✅ 23/23 date tests pass
```

### ❌ Bad — "Should work" completion without evidence

```
Agent: "I've refactored the database layer to use connection pooling. 
The performance should be much better now. Let me know if you have 
any questions!"
```

"Should be." No before/after measurements. No test run. No proof the app even starts.

### ✅ Good — Completion with captured hard evidence

```
Agent: "Refactoring complete. Here's the evidence:

  ✅ Change Scope:  3 files, 47 lines modified
  ✅ Unit Tests:    All 89 pass (0 failures, 0 skipped)
     $ npm test
     Test Suites: 12 passed, 12 total
     Tests:       89 passed, 89 total
     Time:        4.2s
  ✅ Build:         Success
     $ npm run build
     Successfully compiled 34 modules in 2.1s
  ✅ Benchmark:     
     Before: avg 340ms/query (p99: 890ms)
     After:  avg 45ms/query  (p99: 120ms)  ← 7.5x improvement
  ✅ Blast Radius:  Only db/pool.ts, db/query.ts, db/index.ts modified
  
  Banned phrases avoided: no 'should work', no 'probably fixed',
  no 'looks correct'. Only captured stdout above."
```

> Every claim backed by real output. The user can trust this completion report because every line is verifiable.
