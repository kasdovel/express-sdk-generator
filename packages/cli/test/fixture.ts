import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A throwaway project on disk, shared by the `check`, `init`, `watch` and
 * `serve` suites. The route lives in its own module so a test can edit a file
 * the entry only reaches *transitively* — which is the interesting case for
 * watching — and uses an explicit registry so repeated imports of the fixture
 * never collide in the global one.
 */
export const ROUTES_SOURCE = `import express from 'express';
import { z } from 'zod';
import { createRoute, createRegistry } from '@kasdovel/express-sdkgen-core';

export const registry = createRegistry();

createRoute(express.Router(), {
  method: 'get',
  path: '/ping',
  operationId: 'ping',
  responses: { 200: z.object({ ok: z.boolean() }) },
  registry,
  handler: (_req, res) => { res.json({ ok: true }); },
});
`;

export const ENTRY_SOURCE = `export { registry } from './routes.js';\n`;

/** A config module with the given sections spliced in after `spec`. */
export function configSource(extras = ''): string {
  return `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0' },
${extras}};
`;
}

export interface ScaffoldOptions {
  /** Extra config sections, e.g. `"  sdk: { out: 'sdk' },\\n"`. */
  config?: string;
  /** Replace or add files, keyed by project-relative path. */
  files?: Record<string, string>;
}

/** Write a minimal project into a fresh temp directory and return its path. */
export async function scaffold(options: ScaffoldOptions = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sdkgen-test-'));
  const files: Record<string, string> = {
    'src/routes.ts': ROUTES_SOURCE,
    'src/openapi.ts': ENTRY_SOURCE,
    'sdkgen.config.ts': configSource(options.config),
    ...options.files,
  };
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
  }
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Poll until `predicate` holds, or give up. Watch-driven tests need a bound:
 * a missed filesystem event must fail the suite, not hang it.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeout = 8000, interval = 25, what = 'condition' } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
