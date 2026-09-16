import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../src/generate.js';
import { watch, type Watcher, type WatchRun } from '../src/watch.js';
import { cleanup, scaffold, waitFor } from './fixture.js';

/**
 * A project on the documented pattern: routes register into the *global*
 * registry and the entry re-exports it. jiti re-runs these modules on every
 * import, but the global registry itself lives in a package Node caches — so
 * without a reset the second import re-registers into the same instance and
 * trips the duplicate guard.
 */
const GLOBAL_ROUTES = `import express from 'express';
import { z } from 'zod';
import { createRoute } from '@kasdovel/express-sdkgen-core';

createRoute(express.Router(), {
  method: 'get',
  path: '/global',
  operationId: 'globalPing',
  responses: { 200: z.object({ ok: z.boolean() }) },
  handler: (_req, res) => { res.json({ ok: true }); },
});
`;

const GLOBAL_ENTRY = `import './routes.js';
export { registry } from '@kasdovel/express-sdkgen-core';
`;

const dirs: string[] = [];
const watchers: Watcher[] = [];

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()));
  await Promise.all(dirs.splice(0).map(cleanup));
});

async function globalProject(): Promise<string> {
  const dir = await scaffold({
    files: { 'src/routes.ts': GLOBAL_ROUTES, 'src/openapi.ts': GLOBAL_ENTRY },
  });
  dirs.push(dir);
  return dir;
}

async function specPaths(dir: string): Promise<string[]> {
  const doc = JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8')) as {
    paths: Record<string, unknown>;
  };
  return Object.keys(doc.paths).sort();
}

describe('repeated loads of the global registry', () => {
  it('generates the same document twice in one process', async () => {
    const dir = await globalProject();

    await generate({ cwd: dir });
    const first = await specPaths(dir);
    await generate({ cwd: dir });

    expect(first).toEqual(['/global']);
    expect(await specPaths(dir)).toEqual(first);
  }, 15000);

  it('does not leak routes between two projects loaded back to back', async () => {
    const one = await globalProject();
    const two = await globalProject();

    await generate({ cwd: one });
    await generate({ cwd: two });

    expect(await specPaths(two)).toEqual(['/global']);
  }, 15000);

  it('survives a watch-mode regeneration', async () => {
    const dir = await globalProject();
    const runs: WatchRun[] = [];
    const watcher = await watch({ cwd: dir, debounceMs: 20, onRun: (run) => runs.push(run) });
    watchers.push(watcher);

    await writeFile(
      join(dir, 'src', 'routes.ts'),
      GLOBAL_ROUTES.replace('/global', '/renamed'),
      'utf8',
    );
    await waitFor(() => runs.length > 1, { what: 'a regeneration' });

    expect(runs.every((run) => run.ok)).toBe(true);
    expect(await specPaths(dir)).toEqual(['/renamed']);
  }, 15000);
});
