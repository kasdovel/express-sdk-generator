/**
 * A small unified-diff formatter for `sdkgen check`.
 *
 * The CLI has no diff dependency and does not want one: the only consumer is
 * the drift report, where the job is to show a developer *what* changed in a
 * generated file, not to produce patch-appliable output. So this is a plain
 * LCS diff with a hard ceiling — past it the report degrades to a line count
 * rather than spending seconds and megabytes on an inlined Swagger bundle.
 */

/** Files larger than this (after trimming the common head and tail) are summarized. */
const MAX_DIFF_LINES = 1200;

/**
 * Longest line printed before it is elided. A generated docs page inlines the
 * whole spec on one line; dumping that into a terminal buries the change it is
 * supposed to show.
 */
const MAX_LINE_WIDTH = 160;

/** Shorten an over-long diff line, keeping both ends so the change stays visible. */
function elide(line: string): string {
  if (line.length <= MAX_LINE_WIDTH) return line;
  const keep = Math.floor((MAX_LINE_WIDTH - 20) / 2);
  const hidden = line.length - keep * 2;
  return `${line.slice(0, keep)} …${String(hidden)} chars… ${line.slice(-keep)}`;
}

export interface DiffOptions {
  /** Unchanged lines kept around each hunk. Default 3. */
  context?: number;
  /** Ceiling on emitted lines; the rest is replaced by a count. Default 80. */
  maxLines?: number;
}

type Kind = ' ' | '-' | '+';
interface Op {
  kind: Kind;
  text: string;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  // A trailing newline is a terminator, not an empty final line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Longest-common-subsequence ops for two (already trimmed) line arrays. */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  // Every index below is in range by construction; the fallbacks exist only to
  // satisfy `noUncheckedIndexedAccess` without scattering assertions.
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  const lineA = (i: number) => a[i] ?? '';
  const lineB = (j: number) => b[j] ?? '';

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        lineA(i) === lineB(j) ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (lineA(i) === lineB(j)) {
      ops.push({ kind: ' ', text: lineA(i) });
      i++;
      j++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      ops.push({ kind: '-', text: lineA(i) });
      i++;
    } else {
      ops.push({ kind: '+', text: lineB(j) });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', text: lineA(i) });
  for (; j < m; j++) ops.push({ kind: '+', text: lineB(j) });
  return ops;
}

interface Hunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: string[];
}

function toHunks(ops: Op[], context: number): Hunk[] {
  const changed = ops.map((op) => op.kind !== ' ');
  const hunks: Hunk[] = [];

  // Line numbers each op occupies in the old and new files.
  const aLine: number[] = [];
  const bLine: number[] = [];
  let a = 1;
  let b = 1;
  for (const op of ops) {
    aLine.push(a);
    bLine.push(b);
    if (op.kind !== '+') a++;
    if (op.kind !== '-') b++;
  }

  let index = 0;
  while (index < ops.length) {
    if (!changed[index]) {
      index++;
      continue;
    }
    const from = Math.max(0, index - context);
    let to = index;
    // Extend while a further change is within 2×context of the last one, so
    // near-adjacent edits share one hunk instead of repeating their context.
    for (let k = index; k < ops.length; k++) {
      if (changed[k]) to = k;
      else if (k - to > context * 2) break;
    }
    const end = Math.min(ops.length - 1, to + context);

    const slice = ops.slice(from, end + 1);
    hunks.push({
      aStart: aLine[from] ?? 1,
      aCount: slice.filter((op) => op.kind !== '+').length,
      bStart: bLine[from] ?? 1,
      bCount: slice.filter((op) => op.kind !== '-').length,
      lines: slice.map((op) => elide(op.kind + op.text)),
    });
    index = end + 1;
  }
  return hunks;
}

/** Unified diff between two texts, as display lines. Empty when they match. */
export function unifiedDiff(before: string, after: string, options: DiffOptions = {}): string[] {
  if (before === after) return [];
  const context = options.context ?? 3;
  const maxLines = options.maxLines ?? 80;

  const a = splitLines(before);
  const b = splitLines(after);

  // Generated artifacts usually differ in one region of an otherwise identical
  // file; trimming the shared head and tail is what keeps the LCS table small.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const coreA = a.slice(head, endA);
  const coreB = b.slice(head, endB);
  if (coreA.length === 0 && coreB.length === 0) return [];

  if (coreA.length > MAX_DIFF_LINES || coreB.length > MAX_DIFF_LINES) {
    return [
      `  (diff suppressed: ${String(coreA.length)} lines differ from ${String(coreB.length)} — ` +
        'the file is too large to show inline)',
    ];
  }

  const ops: Op[] = [
    ...a.slice(0, head).map((text): Op => ({ kind: ' ', text })),
    ...lcsOps(coreA, coreB),
    ...a.slice(endA).map((text): Op => ({ kind: ' ', text })),
  ];

  const out: string[] = [];
  for (const hunk of toHunks(ops, context)) {
    out.push(
      `@@ -${String(hunk.aStart)},${String(hunk.aCount)} ` +
        `+${String(hunk.bStart)},${String(hunk.bCount)} @@`,
    );
    out.push(...hunk.lines);
  }

  if (out.length > maxLines) {
    const hidden = out.length - maxLines;
    return [...out.slice(0, maxLines), `… ${String(hidden)} more diff lines`];
  }
  return out;
}
