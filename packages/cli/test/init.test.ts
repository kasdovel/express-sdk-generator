import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../src/init.js';
import { generate } from '../src/generate.js';
import { cleanup } from './fixture.js';

const dirs: string[] = [];

async function emptyProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sdkgen-init-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(cleanup));
});

describe('init', () => {
  it('scaffolds a config, an entry, and an example route module', async () => {
    const dir = await emptyProject();

    const result = await init({ cwd: dir });

    expect(result.created).toEqual(['src/routes.ts', 'src/openapi.ts', 'sdkgen.config.ts']);
    expect(result.kept).toEqual([]);

    const config = await readFile(result.configPath, 'utf8');
    expect(config).toContain("entry: 'src/openapi.ts'");
    expect(config).toContain('defineConfig');

    const entry = await readFile(result.entryPath, 'utf8');
    expect(entry).toContain("import './routes.js';");
    expect(entry).toContain('side-effect-free');
    expect(entry).toContain("export { registry } from '@kasdovel/express-sdkgen-core';");
  });

  it('demonstrates the practices the docs recommend', async () => {
    const dir = await emptyProject();
    const result = await init({ cwd: dir });
    const routes = await readFile(result.routesPath, 'utf8');

    // The scaffold is the first sdkgen code anyone reads, so it has to model
    // the recommended way rather than merely a working one: `res.valid` checks
    // the payload against the declared schema, plain `res.json` does not.
    expect(routes).toContain('res.valid(200,');
    expect(routes).not.toContain('res.json(');
  });

  it('takes the spec title and version from package.json when there is one', async () => {
    const dir = await emptyProject();
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'billing-api', version: '2.3.0' }),
      'utf8',
    );

    const result = await init({ cwd: dir });
    const config = await readFile(result.configPath, 'utf8');

    expect(config).toContain("title: 'billing-api'");
    expect(config).toContain("version: '2.3.0'");
  });

  it('refuses to clobber an existing config', async () => {
    const dir = await emptyProject();
    await init({ cwd: dir });
    const before = await readFile(join(dir, 'sdkgen.config.ts'), 'utf8');
    await writeFile(join(dir, 'sdkgen.config.ts'), `${before}// hand-edited\n`, 'utf8');

    await expect(init({ cwd: dir })).rejects.toThrow(/already exists/);
    expect(await readFile(join(dir, 'sdkgen.config.ts'), 'utf8')).toContain('// hand-edited');
  });

  it('detects a config under any of the discovered names', async () => {
    const dir = await emptyProject();
    await writeFile(join(dir, 'sdkgen.config.mjs'), 'export default {};\n', 'utf8');

    await expect(init({ cwd: dir })).rejects.toThrow(/sdkgen.config.mjs already exists/);
  });

  it('overwrites with force', async () => {
    const dir = await emptyProject();
    await init({ cwd: dir });
    await writeFile(join(dir, 'src', 'routes.ts'), '// mine\n', 'utf8');

    const result = await init({ cwd: dir, force: true });

    expect(result.kept).toEqual([]);
    expect(await readFile(join(dir, 'src', 'routes.ts'), 'utf8')).toContain('createRoute');
  });

  it('wires up to route modules that already exist instead of replacing them', async () => {
    const other = await emptyProject();
    await writeFile(join(other, 'existing.ts'), '// user code\n', 'utf8');

    const result = await init({ cwd: other, routes: 'existing.ts', entry: 'entry.ts' });

    expect(result.kept).toEqual(['existing.ts']);
    expect(result.created).toEqual(['entry.ts', 'sdkgen.config.ts']);
    expect(await readFile(join(other, 'existing.ts'), 'utf8')).toBe('// user code\n');
    expect(await readFile(result.entryPath, 'utf8')).toContain("import './existing.js';");
  });

  it('honours custom paths and points the config at the entry it wrote', async () => {
    const dir = await emptyProject();

    const result = await init({
      cwd: dir,
      config: 'config/sdkgen.config.ts',
      entry: 'app/registry.ts',
      routes: 'app/http/routes.ts',
    });

    expect(existsSync(join(dir, 'config', 'sdkgen.config.ts'))).toBe(true);
    expect(await readFile(result.entryPath, 'utf8')).toContain("import './http/routes.js';");
    // `entry` is read relative to the config file, which is a directory down.
    expect(await readFile(result.configPath, 'utf8')).toContain("entry: '../app/registry.ts'");
  });

  it('produces an entry the generator can actually load', async () => {
    const dir = await emptyProject();
    await init({ cwd: dir });

    // The scaffolded config imports `defineConfig` from the published package,
    // which is not installed in a bare temp directory — so the generator is
    // pointed at the scaffolded *entry* through a plain config instead. What is
    // under test is the entry contract, not the config's import.
    await writeFile(
      join(dir, 'sdkgen.config.ts'),
      `export default {
  entry: 'src/openapi.ts',
  spec: { out: 'openapi.json', title: 'T', version: '1.0.0' },
  sdk: { out: 'sdk' },
};
`,
      'utf8',
    );

    const result = await generate({ cwd: dir });
    const spec = JSON.parse(await readFile(result.specPath!, 'utf8')) as {
      paths: Record<string, unknown>;
    };

    expect(Object.keys(spec.paths)).toEqual(['/health']);
    expect(await readFile(join(dir, 'sdk', 'client.ts'), 'utf8')).toContain('getHealth');
  });
});
