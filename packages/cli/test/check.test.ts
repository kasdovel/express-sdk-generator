import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../src/generate.js';
import { check } from '../src/check.js';
import { cleanup, scaffold } from './fixture.js';

const WITH_SDK = `  sdk: { out: 'sdk' },\n`;

let dir: string;

beforeEach(async () => {
  dir = await scaffold({ config: WITH_SDK });
  await generate({ cwd: dir });
});

afterEach(async () => {
  await cleanup(dir);
});

describe('check', () => {
  it('passes on freshly generated artifacts', async () => {
    const result = await check({ cwd: dir });

    expect(result.clean).toBe(true);
    expect(result.drift).toEqual([]);
    expect(result.checked).toContain('openapi.json');
    expect(result.checked).toContain('sdk/client.ts');
  });

  it('reports an edited artifact as changed, with a diff', async () => {
    const spec = await readFile(join(dir, 'openapi.json'), 'utf8');
    await writeFile(join(dir, 'openapi.json'), spec.replace('"T"', '"Stale"'), 'utf8');

    const result = await check({ cwd: dir });

    expect(result.clean).toBe(false);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      artifact: 'spec',
      status: 'changed',
      path: 'openapi.json',
    });
    expect(result.drift[0]!.diff).toContain('-    "title": "Stale",');
    expect(result.drift[0]!.diff).toContain('+    "title": "T",');
  });

  it('reports a missing generated file as added', async () => {
    await rm(join(dir, 'sdk', 'client.ts'));

    const result = await check({ cwd: dir });

    expect(result.clean).toBe(false);
    expect(result.drift).toEqual([
      { artifact: 'sdk', status: 'added', path: 'sdk/client.ts', diff: [] },
    ]);
  });

  it('reports a file generation no longer produces as removed', async () => {
    await writeFile(join(dir, 'sdk', 'legacy.ts'), 'export {};\n', 'utf8');

    const result = await check({ cwd: dir });

    expect(result.drift).toEqual([
      { artifact: 'sdk', status: 'removed', path: 'sdk/legacy.ts', diff: [] },
    ]);
  });

  it('never writes over the committed artifacts', async () => {
    const stale = '{ "not": "the spec" }\n';
    await writeFile(join(dir, 'openapi.json'), stale, 'utf8');

    const result = await check({ cwd: dir });

    expect(result.clean).toBe(false);
    expect(await readFile(join(dir, 'openapi.json'), 'utf8')).toBe(stale);
  });

  it('scopes to the requested artifact', async () => {
    await writeFile(join(dir, 'sdk', 'client.ts'), '// drifted\n', 'utf8');

    expect((await check({ cwd: dir, only: ['spec'] })).clean).toBe(true);
    expect((await check({ cwd: dir, only: ['sdk'] })).clean).toBe(false);
    expect((await check({ cwd: dir })).clean).toBe(false);
  });

  it('can list stale files without diffing them', async () => {
    await writeFile(join(dir, 'sdk', 'client.ts'), '// drifted\n', 'utf8');

    const result = await check({ cwd: dir, diff: false });

    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]!.diff).toEqual([]);
  });

  it('covers the YAML copy when one is configured', async () => {
    const yamlDir = await scaffold({ config: `  sdk: { out: 'sdk' },\n` });
    await writeFile(
      join(yamlDir, 'sdkgen.config.ts'),
      `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0', yamlOut: 'spec/api.yaml' },
};
`,
      'utf8',
    );
    await generate({ cwd: yamlDir });
    expect((await check({ cwd: yamlDir })).checked).toContain(join('spec', 'api.yaml'));

    await writeFile(join(yamlDir, 'spec', 'api.yaml'), 'openapi: nope\n', 'utf8');
    const result = await check({ cwd: yamlDir });
    expect(result.clean).toBe(false);
    expect(result.drift[0]!.status).toBe('changed');

    await cleanup(yamlDir);
  });

  it('surfaces a configuration error instead of reporting drift', async () => {
    const broken = await scaffold({ config: '' });
    await writeFile(join(broken, 'src', 'routes.ts'), 'throw new Error("boom");\n', 'utf8');

    await expect(check({ cwd: broken })).rejects.toThrow(/boom/);

    await cleanup(broken);
  });
});
