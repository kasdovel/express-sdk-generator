import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, type ServeHandle } from '../src/serve.js';
import { cleanup, scaffold, waitFor, ROUTES_SOURCE } from './fixture.js';

const open: ServeHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
  await Promise.all(dirs.splice(0).map(cleanup));
});

async function start(): Promise<{ dir: string; handle: ServeHandle }> {
  const dir = await scaffold();
  dirs.push(dir);
  const handle = await serve({ cwd: dir, port: 0, quiet: true, debounceMs: 20 });
  open.push(handle);
  return { dir, handle };
}

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

describe('serve', () => {
  it('serves the document built from the registry', async () => {
    const { handle } = await start();

    const res = await fetch(`${handle.url}/openapi.json`);
    const doc = (await res.json()) as { paths: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(Object.keys(doc.paths)).toEqual(['/ping']);
  }, 15000);

  it('serves a docs page that subscribes to reloads', async () => {
    const { handle } = await start();

    const html = await (await fetch(handle.url)).text();

    expect(html).toContain('swagger-ui');
    expect(html).toContain('new EventSource("/__sdkgen/reload")');
  }, 15000);

  it('does not re-import the entry for every request', async () => {
    const { handle } = await start();

    await fetch(handle.url);
    await fetch(`${handle.url}/openapi.json`);
    await fetch(handle.url);

    // The build number only moves when the watcher says something changed.
    expect(handle.version).toBe(1);
  }, 15000);

  it('rebuilds when a source file changes', async () => {
    const { dir, handle } = await start();

    await writeFile(join(dir, 'src', 'routes.ts'), EXTENDED_ROUTES, 'utf8');
    await waitFor(() => handle.version > 1, { what: 'a rebuild' });

    const doc = (await (await fetch(`${handle.url}/openapi.json`)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths).sort()).toEqual(['/ping', '/pong']);
  }, 15000);

  it('pushes a reload event to a subscribed browser', async () => {
    const { dir, handle } = await start();

    const controller = new AbortController();
    const stream = await fetch(`${handle.url}/__sdkgen/reload`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    // The retry hint arrives immediately; the reload event follows the rebuild.
    await reader.read();

    await writeFile(join(dir, 'src', 'routes.ts'), EXTENDED_ROUTES, 'utf8');
    const chunk = await reader.read();

    expect(new TextDecoder().decode(chunk.value)).toContain('event: reload');
    controller.abort();
  }, 15000);

  it('reports a broken entry instead of crashing, and recovers', async () => {
    const dir = await scaffold();
    dirs.push(dir);
    await writeFile(join(dir, 'src', 'routes.ts'), 'throw new Error("broken");\n', 'utf8');

    const handle = await serve({ cwd: dir, port: 0, quiet: true, debounceMs: 20 });
    open.push(handle);

    const bad = await fetch(`${handle.url}/openapi.json`);
    expect(bad.status).toBe(500);
    expect(await bad.text()).toContain('broken');
    // The shell still renders, so the page can recover on its own.
    expect((await fetch(handle.url)).status).toBe(200);

    await writeFile(join(dir, 'src', 'routes.ts'), ROUTES_SOURCE, 'utf8');
    await waitFor(async () => (await fetch(`${handle.url}/openapi.json`)).status === 200, {
      what: 'the entry to recover',
    });
  }, 15000);
});
