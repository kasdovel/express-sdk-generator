import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * The typed half of `res.valid` is the valuable half, and vitest alone never
 * sees it — types are gone by the time a test runs. So compile the fixture for
 * real. Its `@ts-expect-error` markers assert the *negative* cases (an
 * undeclared status, a payload of the wrong shape), which means this one `tsc`
 * run covers both directions.
 */
describe('res.valid typing', () => {
  it('compiles the fixture, including its @ts-expect-error assertions', async () => {
    const project = resolve(here, 'types/tsconfig.json');
    const tsc = resolve(here, '../../../node_modules/typescript/bin/tsc');

    let output = '';
    try {
      await run(process.execPath, [tsc, '--noEmit', '-p', project]);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(output).toBe('');
  }, 60_000);
});
