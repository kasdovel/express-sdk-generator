import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitDocs } from '../src/emitDocs.js';

const DOC = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} };

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdkgen-docs-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function generate(docs: Parameters<typeof emitDocs>[1]): Promise<string> {
  const out = await emitDocs(DOC, docs, dir);
  return readFile(out, 'utf8');
}

describe('emitDocs', () => {
  it('references a CDN by default (swagger)', async () => {
    const html = await generate({ out: 'cdn-swagger.html' });
    expect(html).toContain('unpkg.com/swagger-ui-dist');
    expect(html).toContain('3.1.0'); // spec inlined
  });

  it('loads no external assets when offline (swagger)', async () => {
    const html = await generate({ out: 'off-swagger.html', offline: true });
    // No CDN hosts and no element fetching a remote asset. (Asset *text* may
    // still mention https:// in comments — what matters is nothing is loaded.)
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toMatch(/src="https:\/\//);
    expect(html).not.toMatch(/href="https:\/\//);
    // Real vendored asset content is present.
    expect(html).toContain('SwaggerUIBundle');
  });

  it('loads no external assets when offline (redoc)', async () => {
    const html = await generate({
      out: 'off-redoc.html',
      ui: 'redoc',
      offline: true,
    });
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toMatch(/src="https:\/\//);
    expect(html).toContain('Redoc.init');
  });
});
