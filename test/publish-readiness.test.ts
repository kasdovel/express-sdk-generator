/**
 * Verify publication readiness of @kasdovel/express-sdkgen-core and @kasdovel/express-sdkgen-cli.
 *
 * Acceptance criteria (issue #11):
 * 1. `pnpm pack --dry-run` succeeds for both packages
 * 2. No source files (outside dist/, package.json, README.md, LICENSE) are included
 * 3. CJS and ESM imports of built dist outputs succeed without resolution errors
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES = [
  { name: '@kasdovel/express-sdkgen-core', dir: join(ROOT, 'packages', 'core') },
  { name: '@kasdovel/express-sdkgen-cli', dir: join(ROOT, 'packages', 'cli') },
] as const;

/**
 * Allowed top-level entries in the tarball.
 * Everything must live under `dist/`, or be one of the metadata files.
 */
const ALLOWED_TOP_LEVEL = new Set(['dist', 'package.json', 'README.md', 'LICENSE']);

interface PackFile {
  path: string;
}
interface PackResult {
  name: string;
  version: string;
  filename: string;
  files: PackFile[];
}

function packDryRun(cwd: string): PackResult {
  const raw = execSync('pnpm pack --dry-run --json', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(raw) as PackResult;
}

// ─── AC 1: pnpm pack --dry-run succeeds ────────────────────────────────────
describe('AC-1: pnpm pack --dry-run succeeds', () => {
  for (const pkg of PACKAGES) {
    it(`${pkg.name}`, () => {
      const result = packDryRun(pkg.dir);
      expect(result.name).toBe(pkg.name);
      expect(result.filename).toMatch(/\.tgz$/);
      expect(result.files.length).toBeGreaterThan(0);
    });
  }
});

// ─── AC 2: No source files leak into the tarball ───────────────────────────
describe('AC-2: No source files outside dist/, package.json, README.md, LICENSE', () => {
  for (const pkg of PACKAGES) {
    it(`${pkg.name}: only allowed files are included`, () => {
      const result = packDryRun(pkg.dir);
      const filePaths = result.files.map((f) => f.path);

      for (const filePath of filePaths) {
        const topLevel = filePath.split('/')[0];
        expect(ALLOWED_TOP_LEVEL).toContain(topLevel);
      }
    });

    it(`${pkg.name}: no .ts source files in tarball`, () => {
      const result = packDryRun(pkg.dir);
      const tsSourceFiles = result.files.filter(
        (f) => f.path.endsWith('.ts') && !f.path.endsWith('.d.ts') && !f.path.endsWith('.d.cts'),
      );
      expect(tsSourceFiles).toEqual([]);
    });

    it(`${pkg.name}: no test files in tarball`, () => {
      const result = packDryRun(pkg.dir);
      const testFiles = result.files.filter(
        (f) => f.path.includes('test/') || f.path.includes('.test.'),
      );
      expect(testFiles).toEqual([]);
    });

    it(`${pkg.name}: no config files (tsconfig, tsup.config, vitest.config) in tarball`, () => {
      const result = packDryRun(pkg.dir);
      const configFiles = result.files.filter(
        (f) =>
          f.path.includes('tsconfig') ||
          f.path.includes('tsup.config') ||
          f.path.includes('vitest.config'),
      );
      expect(configFiles).toEqual([]);
    });

    it(`${pkg.name}: includes package.json, README.md, and LICENSE`, () => {
      const result = packDryRun(pkg.dir);
      const filePaths = result.files.map((f) => f.path);
      expect(filePaths).toContain('package.json');
      expect(filePaths).toContain('README.md');
      expect(filePaths).toContain('LICENSE');
    });
  }
});

// ─── AC 3: CJS and ESM imports resolve without errors ──────────────────────
describe('AC-3: Built dist imports resolve without errors', () => {
  describe('@kasdovel/express-sdkgen-core', () => {
    const coreDist = join(ROOT, 'packages', 'core', 'dist');

    it('ESM entry exists and is importable', async () => {
      const esmEntry = join(coreDist, 'index.js');
      expect(existsSync(esmEntry)).toBe(true);

      const mod = await import(esmEntry);
      expect(mod).toBeDefined();
      expect(typeof mod.createRoute).toBe('function');
      expect(typeof mod.registry).toBe('object');
      expect(typeof mod.buildDocument).toBe('function');
    });

    it('CJS entry exists and is loadable', () => {
      const cjsEntry = join(coreDist, 'index.cjs');
      expect(existsSync(cjsEntry)).toBe(true);

      // Use a subprocess to test CJS require in a clean context
      const result = execSync(
        `node -e "const m = require('${cjsEntry.replace(/\\/g, '\\\\')}'); if (!m.createRoute) throw new Error('missing createRoute'); if (!m.registry) throw new Error('missing registry'); console.log('OK')"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(result.trim()).toBe('OK');
    });

    it('type declarations exist', () => {
      expect(existsSync(join(coreDist, 'index.d.ts'))).toBe(true);
      expect(existsSync(join(coreDist, 'index.d.cts'))).toBe(true);
    });
  });

  describe('@kasdovel/express-sdkgen-cli', () => {
    const cliDist = join(ROOT, 'packages', 'cli', 'dist');

    it('ESM entry exists and is importable', async () => {
      const esmEntry = join(cliDist, 'index.js');
      expect(existsSync(esmEntry)).toBe(true);

      const mod = await import(esmEntry);
      expect(mod).toBeDefined();
      expect(typeof mod.defineConfig).toBe('function');
      expect(typeof mod.generate).toBe('function');
    });

    it('bin entry exists', () => {
      const binEntry = join(cliDist, 'bin.js');
      expect(existsSync(binEntry)).toBe(true);
    });

    it('type declarations exist', () => {
      expect(existsSync(join(cliDist, 'index.d.ts'))).toBe(true);
    });
  });
});
