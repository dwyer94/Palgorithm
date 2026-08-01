import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against a raw NUL byte landing in a source file.
 *
 * Git classifies any file with a NUL in its first 8000 bytes as binary, and from then on
 * silently stops producing diffs for it — `git diff` reports `Bin 15770 -> 16864 bytes`, blame
 * is useless, and pull requests can't carry line-level review comments on it. `combirank.ts`
 * spent an unknown stretch in that state: its `pairKey` separator was written as a literal
 * U+0000 byte rather than the `\u0000` escape, leaving the repo's most correctness-critical
 * file — the CombiRank implementation behind CLAUDE.md invariant 1 — as the one file nobody
 * could review as a diff.
 *
 * Nothing about the failure is visible while writing code: the escape and the literal byte
 * produce an identical string at runtime, tests pass either way, and the build is unaffected.
 * You only find out when you try to read a diff. Hence a test rather than a convention.
 */

const ROOTS = ['src', 'test'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

describe('source encoding', () => {
  it('has no raw NUL bytes in any TypeScript source file', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (!SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
        if (readFileSync(file).includes(0)) offenders.push(file);
      }
    }
    // Fix by writing the byte as the `\u0000` escape instead: identical string at
    // runtime, and the file stays text so git keeps diffing it.
    expect(offenders).toEqual([]);
  });
});
