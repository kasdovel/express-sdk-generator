import { describe, it, expect } from 'vitest';
import { unifiedDiff } from '../src/diff.js';

describe('unifiedDiff', () => {
  it('is empty for identical text, with or without a trailing newline', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toEqual([]);
    expect(unifiedDiff('a\nb\n', 'a\nb')).toEqual([]);
  });

  it('shows a changed line with surrounding context', () => {
    const before = ['one', 'two', 'three', 'four', 'five'].join('\n');
    const after = ['one', 'two', 'THREE', 'four', 'five'].join('\n');
    const diff = unifiedDiff(before, after);

    expect(diff[0]).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    expect(diff).toContain('-three');
    expect(diff).toContain('+THREE');
    expect(diff).toContain(' two');
    expect(diff).toContain(' four');
  });

  it('reports additions and removals', () => {
    expect(unifiedDiff('a\n', 'a\nb\n')).toContain('+b');
    expect(unifiedDiff('a\nb\n', 'a\n')).toContain('-b');
  });

  it('leaves untouched regions out of the output', () => {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 100', 'line 100!');
    const diff = unifiedDiff(before, after);

    // Two hunk-free ends: only the edit plus its context should appear.
    expect(diff.length).toBeLessThan(12);
    expect(diff).toContain('+line 100!');
  });

  it('truncates rather than printing an unbounded diff', () => {
    const before = Array.from({ length: 100 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 100 }, (_, i) => `b${i}`).join('\n');
    const diff = unifiedDiff(before, after, { maxLines: 10 });

    expect(diff).toHaveLength(11);
    expect(diff[10]).toMatch(/more diff lines$/);
  });

  it('suppresses the diff for very large changes', () => {
    const before = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 4000 }, (_, i) => `b${i}`).join('\n');
    const diff = unifiedDiff(before, after);

    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain('diff suppressed');
  });
});
