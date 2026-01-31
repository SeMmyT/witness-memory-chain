# Memory Chain: Content Verification Patch

**Issue:** `verify` command and `list --show-content` don't verify that content files match their `content_hash`. Content can be tampered without detection.

**Found by:** Klowalski (2026-01-31) — ironically, by tampering with my own memories.

**Severity:** HIGH — undermines the core trust guarantee of the system.

---

## Bug 1: `verifyChain()` doesn't verify content files

**File:** `src/chain/index.ts`

**Current behavior:** Only checks header integrity (hash chain, signatures, sequence). Ignores content files entirely.

**Fix:** After verifying each entry's signature, also verify its content file matches `content_hash`.

```typescript
// In verifyChain(), after the signature verification block, add:

// Verify content integrity
const contentDir = join(dataDir, 'content');
const contentValid = await verifyContent(contentDir, entry.content_hash);
if (!contentValid) {
  // Check if content is missing (redacted) vs tampered
  const exists = await contentExists(contentDir, entry.content_hash);
  if (exists) {
    errors.push({
      seq: entry.seq,
      type: 'content_tampered',
      message: `Content file tampered: hash mismatch for entry ${entry.seq}`,
    });
  }
  // Note: missing content is OK (redacted entries) — don't error
}
```

**Required imports:** Add to imports at top of file:
```typescript
import { verifyContent, contentExists } from '../storage/content-store.js';
```

**Also update:** `VerificationError['type']` in `src/types.ts` to include `'content_tampered'`.

---

## Bug 2: CLI verify output should report content verification

**File:** `src/cli.ts`

**Current output:**
```
Internal Consistency: VALID
  - Entries checked: 10
  - Hash chain: All entries link correctly
  - Signatures: All verified
  - Sequence: No gaps
```

**New output should include:**
```
Internal Consistency: VALID
  - Entries checked: 10
  - Hash chain: All entries link correctly
  - Signatures: All verified
  - Sequence: No gaps
  - Content files: All verified (or "X tampered" if issues found)
```

---

## Bug 3: `list --show-content` should verify before display

**File:** `src/cli.ts`

**Current code (around line 118):**
```typescript
const content = await getContent(contentDir, entry.content_hash);
```

**Fix:** Use verified retrieval and handle tampering:
```typescript
import { getContent, getContentVerified, ContentIntegrityError } from '../storage/content-store.js';

// In list command:
if (showContent) {
  try {
    const content = await getContentVerified(contentDir, entry.content_hash);
    if (content) {
      const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
      console.log(`  Content: ${preview}`);
    } else {
      console.log('  Content: [REDACTED]');
    }
  } catch (err) {
    if (err instanceof ContentIntegrityError) {
      console.log('  Content: [TAMPERED - hash mismatch!]');
    } else {
      throw err;
    }
  }
}
```

---

## Bug 4: Add `--verify-content` flag to verify command (optional enhancement)

For performance, you might want content verification to be optional (it requires reading all content files).

```typescript
program
  .command('verify')
  .description('Verify chain integrity')
  .option('--skip-content', 'Skip content file verification (faster)', false)
  .action(async (options) => {
    // Pass options.skipContent to verifyChain
  });
```

But honestly, for most chains (< 10,000 entries), verifying content is fast enough to be default behavior.

---

## Test Cases to Add

**File:** `test/chain.test.ts`

```typescript
describe('Content Verification', () => {
  it('should detect tampered content during verify', async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, {
      type: 'memory',
      content: 'Original content',
    });

    // Tamper with content file
    const entries = await readChain(testDir);
    const hashHex = entries[1].content_hash.slice(7); // Remove "sha256:"
    const contentPath = join(testDir, 'content', hashHex);
    await writeFile(contentPath, 'Tampered content');

    // Verify should catch it
    const result = await verifyChain(testDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'content_tampered')).toBe(true);
  });

  it('should not error on redacted (missing) content', async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, {
      type: 'memory',
      content: 'Content to redact',
    });

    // Delete content file (simulating redaction)
    const entries = await readChain(testDir);
    const hashHex = entries[1].content_hash.slice(7);
    const contentPath = join(testDir, 'content', hashHex);
    await unlink(contentPath);

    // Verify should still pass (missing != tampered)
    const result = await verifyChain(testDir);
    expect(result.valid).toBe(true);
  });
});
```

---

## Summary

1. **`verifyChain()`** — add content hash verification loop
2. **`list --show-content`** — use `getContentVerified()`, show `[TAMPERED]` on mismatch  
3. **Types** — add `'content_tampered'` to error types
4. **Tests** — add tampering detection tests
5. **CLI output** — report content verification status

The building blocks (`verifyContent`, `getContentVerified`, `ContentIntegrityError`) already exist — they just need to be wired in.

---

*Patch spec by Klowalski, 2026-01-31*
