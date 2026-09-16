# `sdkgen check` compares a real regeneration, not an in-memory one

Every artifact is generated from one declaration, so the Spec, Docs and SDK cannot disagree
with the routes — as long as somebody remembers to run the generator. Nothing stopped a route
change from being committed without regenerating, which is the one way Drift could still reach
`master`. `sdkgen check` closes it: regenerate, compare against what is committed, exit
non-zero on a difference, one line in CI.

The comparison runs against a **real generation into a temporary directory**, not against
artifact content held in memory. `check` therefore exercises the same code path users run —
the same path resolution, the same file layout, the same `mkdir`, the same YAML sibling, the
same directory of SDK files — and then diffs the resulting trees (`diff.ts`) against the
committed ones.

## Considered Options

- **Refactor the emitters to return strings and compare in memory.** The obvious shape, and
  tempting: no temp directory, no filesystem. Rejected because it would make the gate check
  something other than what `gen` does. Everything between "here is the content" and "here is
  the file on disk" — which path `spec.yamlOut` resolves to, which files an SDK directory
  contains, whether a renamed output leaves the old file behind — is exactly where staleness
  hides, and an in-memory comparison is blind to all of it. A gate that can pass while `gen`
  produces something different is worse than no gate.
- **Compare content hashes instead of diffing.** Cheaper and enough to answer "is it stale?",
  but the answer a developer needs is _what_ changed. `check` prints a unified diff per file,
  which also makes it useful in review, not just in CI.

## Consequences

- `check` costs a full generation plus a tree walk. It is a CI gate and a pre-commit check, not
  something to run on every keystroke — `gen --watch` covers that.
- Diff output is bounded: over-long lines are elided and very large diffs truncated. The
  generated docs page inlines the entire spec on a single line, so an unbounded diff would bury
  a one-word change under kilobytes of JSON.
- The emitters keep writing files as their only contract, which leaves them free to write
  several files, create directories, or skip work — none of which an in-memory string API would
  express naturally.
