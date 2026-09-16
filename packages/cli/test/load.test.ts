import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadRegistry } from '../src/load.js';
import { resolveConfigPath } from '../src/config.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdkgen-load-'));
  await mkdir(join(dir, 'src'), { recursive: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, source: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, source, 'utf8');
  return path;
}

describe('resolveConfigPath', () => {
  it('reports an explicit path that does not exist', () => {
    expect(() => resolveConfigPath(dir, 'nope.config.ts')).toThrow(/Config file not found/);
  });

  it('lists the names it looked for when nothing is found', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sdkgen-empty-'));
    expect(() => resolveConfigPath(empty)).toThrow(/sdkgen\.config\.ts/);
    await rm(empty, { recursive: true, force: true });
  });
});

describe('loadConfig', () => {
  it('rejects a config with no entry', async () => {
    const path = await write('no-entry.config.ts', `export default { spec: {} };\n`);
    await expect(loadConfig(path)).rejects.toThrow(/must export an object with an "entry" string/);
  });

  it('reads a default-exported config', async () => {
    const path = await write(
      'ok.config.ts',
      `export default { entry: 'src/openapi.ts', spec: { title: 'T', version: '1' } };\n`,
    );
    await expect(loadConfig(path)).resolves.toMatchObject({ entry: 'src/openapi.ts' });
  });
});

describe('loadRegistry', () => {
  it('explains how to fix an entry that exports no registry', async () => {
    const configPath = await write(
      'bare.config.ts',
      `export default { entry: 'src/bare.ts', spec: { title: 'T', version: '1' } };\n`,
    );
    await write('src/bare.ts', `export const notARegistry = 1;\n`);

    await expect(
      loadRegistry({ entry: 'src/bare.ts', spec: { title: 'T', version: '1' } }, configPath),
    ).rejects.toThrow(/did not export a Registry as "registry"/);
  });

  it('honors a custom registryExport name', async () => {
    const configPath = await write(
      'custom.config.ts',
      `export default { entry: 'src/custom.ts', spec: { title: 'T', version: '1' } };\n`,
    );
    await write(
      'src/custom.ts',
      `import { createRegistry } from '@kasdovel/express-sdkgen-core';
export const apiRegistry = createRegistry();
`,
    );

    const registry = await loadRegistry(
      {
        entry: 'src/custom.ts',
        registryExport: 'apiRegistry',
        spec: { title: 'T', version: '1' },
      },
      configPath,
    );
    expect(registry.routes).toEqual([]);
  });
});
