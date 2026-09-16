import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate.js';

/** A minimal project on disk: one route, a config, no Express app to boot. */
async function scaffold(configExtras: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sdkgen-gen-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'src', 'openapi.ts'),
    `import express from 'express';
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
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'sdkgen.config.ts'),
    `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0' },
${configExtras}};
`,
    'utf8',
  );
  return dir;
}

let dir: string;
beforeAll(async () => {
  dir = await scaffold(`  sdk: { out: 'sdk' },\n`);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('generate', () => {
  it('writes only the artifacts that were asked for', async () => {
    const result = await generate({ cwd: dir, only: ['sdk'] });

    expect(result.sdkDir).toBeDefined();
    expect(await readdir(join(dir, 'sdk'))).toContain('client.ts');
    // The document is still built in memory, but the spec file is left alone.
    expect(result.specPath).toBeUndefined();
    expect(existsSync(join(dir, 'openapi.json'))).toBe(false);
  });

  it('writes the spec when asked', async () => {
    const result = await generate({ cwd: dir, only: ['spec'] });
    expect(result.specPath).toBe(join(dir, 'openapi.json'));
    expect(existsSync(join(dir, 'openapi.json'))).toBe(true);
  });

  it('fails when an artifact is requested but not configured', async () => {
    const bare = await scaffold('');
    await expect(generate({ cwd: bare, only: ['docs'] })).rejects.toThrow(/needs a "docs" section/);
    // `gen all` stays permissive: nothing configured, nothing emitted.
    const all = await generate({ cwd: bare });
    expect(all.docsPath).toBeUndefined();
    expect(all.sdkDir).toBeUndefined();
    expect(all.specPath).toBeDefined();
    await rm(bare, { recursive: true, force: true });
  });
});

describe('emitSpec yaml output', () => {
  it('rejects a YAML spec.out that would collide with the YAML copy', async () => {
    const yamlDir = await scaffold('');
    await writeFile(
      join(yamlDir, 'sdkgen.config.ts'),
      `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.yaml', title: 'T', version: '1.0.0', yaml: true },
};
`,
      'utf8',
    );
    await expect(generate({ cwd: yamlDir })).rejects.toThrow(/would collide/);
    await rm(yamlDir, { recursive: true, force: true });
  });

  it('writes a .yaml sibling next to the .json spec', async () => {
    const yamlDir = await scaffold('');
    await writeFile(
      join(yamlDir, 'sdkgen.config.ts'),
      `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0', yaml: true },
};
`,
      'utf8',
    );
    const result = await generate({ cwd: yamlDir });
    expect(result.yamlPath).toBe(join(yamlDir, 'openapi.yaml'));
    expect(existsSync(join(yamlDir, 'openapi.yaml'))).toBe(true);
    await rm(yamlDir, { recursive: true, force: true });
  });

  /** Write a config with the given `spec` body and generate from it. */
  async function withSpec(spec: string) {
    const specDir = await scaffold('');
    await writeFile(
      join(specDir, 'sdkgen.config.ts'),
      `export default { entry: 'src/openapi.ts', spec: { ${spec} } };\n`,
      'utf8',
    );
    return { dir: specDir, result: await generate({ cwd: specDir }) };
  }

  it('honours an explicit spec.yamlOut', async () => {
    const { dir: specDir, result } = await withSpec(
      `out: 'openapi.json', title: 'T', version: '1.0.0', yaml: true, yamlOut: 'spec/api.yaml'`,
    );

    expect(result.yamlPath).toBe(join(specDir, 'spec', 'api.yaml'));
    expect(existsSync(join(specDir, 'spec', 'api.yaml'))).toBe(true);
    // The inferred sibling is not written when an explicit path is given.
    expect(existsSync(join(specDir, 'openapi.yaml'))).toBe(false);
    await rm(specDir, { recursive: true, force: true });
  });

  it('treats spec.yamlOut as asking for YAML', async () => {
    const { dir: specDir, result } = await withSpec(
      `out: 'openapi.json', title: 'T', version: '1.0.0', yamlOut: 'api.yaml'`,
    );

    expect(result.yamlPath).toBe(join(specDir, 'api.yaml'));
    expect(existsSync(join(specDir, 'api.yaml'))).toBe(true);
    await rm(specDir, { recursive: true, force: true });
  });

  it('accepts a YAML spec.out once yamlOut disambiguates the pair', async () => {
    const { dir: specDir, result } = await withSpec(
      `out: 'spec.yaml', title: 'T', version: '1.0.0', yaml: true, yamlOut: 'spec-copy.yaml'`,
    );

    expect(result.specPath).toBe(join(specDir, 'spec.yaml'));
    expect(result.yamlPath).toBe(join(specDir, 'spec-copy.yaml'));
    await rm(specDir, { recursive: true, force: true });
  });

  it('rejects a yamlOut that points at the JSON spec', async () => {
    const specDir = await scaffold('');
    await writeFile(
      join(specDir, 'sdkgen.config.ts'),
      `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0', yamlOut: './openapi.json' },
};
`,
      'utf8',
    );

    await expect(generate({ cwd: specDir })).rejects.toThrow(/would collide/);
    // Nothing is written when the paths do not make sense.
    expect(existsSync(join(specDir, 'openapi.json'))).toBe(false);
    await rm(specDir, { recursive: true, force: true });
  });
});
