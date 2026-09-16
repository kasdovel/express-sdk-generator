import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { watch, type Watcher, type WatchRun } from '../src/watch.js';
import { cleanup, scaffold, waitFor, ROUTES_SOURCE } from './fixture.js';

const open: Watcher[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((watcher) => watcher.close()));
  await Promise.all(dirs.splice(0).map(cleanup));
});

async function project(config = ''): Promise<string> {
  const dir = await scaffold({ config });
  dirs.push(dir);
  return dir;
}

async function start(dir: string, runs: WatchRun[]): Promise<Watcher> {
  const watcher = await watch({
    cwd: dir,
    debounceMs: 20,
    onRun: (run) => runs.push(run),
  });
  open.push(watcher);
  return watcher;
}

/** A route module with a second operation, so regeneration is observable. */
const EXTENDED_ROUTES = `${ROUTES_SOURCE}
createRoute(express.Router(), {
  method: 'get',
  path: '/pong',
  operationId: 'pong',
  responses: { 200: z.object({ ok: z.boolean() }) },
  registry,
  handler: (_req, res) => { res.json({ ok: true }); },
});
`;

describe('gen --watch', () => {
  it('generates once up front', async () => {
    const dir = await project();
    const runs: WatchRun[] = [];

    await start(dir, runs);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: true, trigger: undefined });
    expect(runs[0]!.result?.specPath).toBe(join(dir, 'openapi.json'));
  });

  it('regenerates when a module the entry imports changes', async () => {
    const dir = await project();
    const runs: WatchRun[] = [];
    await start(dir, runs);

    // `src/routes.ts` is reached only through the entry, which is the case the
    // watcher has to cover: watching the entry file alone would miss it.
    await writeFile(join(dir, 'src', 'routes.ts'), EXTENDED_ROUTES, 'utf8');

    await waitFor(() => runs.length > 1, { what: 'a regeneration' });
    expect(runs[runs.length - 1]).toMatchObject({ ok: true });
    expect(runs[runs.length - 1]!.trigger).toBe(join(dir, 'src', 'routes.ts'));

    const spec = await readFile(join(dir, 'openapi.json'), 'utf8');
    expect(spec).toContain('/pong');
  }, 15000);

  it('keeps running after a failed regeneration', async () => {
    const dir = await project();
    const runs: WatchRun[] = [];
    await start(dir, runs);

    await writeFile(join(dir, 'src', 'routes.ts'), 'throw new Error("broken");\n', 'utf8');
    await waitFor(() => runs.some((run) => !run.ok), { what: 'a failing run' });
    expect(runs[runs.length - 1]!.error).toBeInstanceOf(Error);

    await writeFile(join(dir, 'src', 'routes.ts'), ROUTES_SOURCE, 'utf8');
    await waitFor(() => runs[runs.length - 1]!.ok, { what: 'a recovery' });
    expect(runs[runs.length - 1]!.ok).toBe(true);
  }, 15000);

  it('does not retrigger itself on the files it writes', async () => {
    const dir = await project(`  sdk: { out: 'sdk' },\n`);
    const runs: WatchRun[] = [];
    await start(dir, runs);

    // The initial run wrote openapi.json and sdk/; if those writes were not
    // excluded from the watch, the count would keep climbing on its own.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(runs).toHaveLength(1);
  }, 15000);

  it('stops watching once closed', async () => {
    const dir = await project();
    const runs: WatchRun[] = [];
    const watcher = await start(dir, runs);

    await watcher.close();
    await writeFile(join(dir, 'src', 'routes.ts'), EXTENDED_ROUTES, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(runs).toHaveLength(1);
  }, 15000);
});
