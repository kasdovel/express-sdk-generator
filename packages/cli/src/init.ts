import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { resolveConfigPath } from './config.js';

export interface InitOptions {
  cwd?: string;
  /** Directory to scaffold into. Default: `cwd`. */
  dir?: string;
  /** Config filename, relative to `dir`. Default `sdkgen.config.ts`. */
  config?: string;
  /** Entry module, relative to `dir`. Default `src/openapi.ts`. */
  entry?: string;
  /** Example route module, relative to `dir`. Default `src/routes.ts`. */
  routes?: string;
  /** Overwrite files that already exist. Default `false`. */
  force?: boolean;
}

export interface InitResult {
  dir: string;
  configPath: string;
  entryPath: string;
  routesPath: string;
  /** Files written, relative to `dir`. */
  created: string[];
  /** Files left untouched because they already existed, relative to `dir`. */
  kept: string[];
}

/** A TS source path as an ESM specifier: `src/routes.ts` → `./routes.js`. */
function importSpecifier(from: string, to: string): string {
  const rel = relative(dirname(from), to).split(sep).join('/');
  const js = rel.replace(/\.(m|c)?tsx?$/, '.js');
  return js.startsWith('.') ? js : `./${js}`;
}

function configTemplate(entrySpecifier: string, title: string, version: string): string {
  return `import { defineConfig } from '@kasdovel/express-sdkgen-cli';

export default defineConfig({
  // Imported in-process by the generator, so it must be side-effect-free.
  entry: '${entrySpecifier}',
  spec: {
    out: 'openapi.json',
    openapi: '3.1',
    title: '${title}',
    version: '${version}',
    // yaml: true,               // also write openapi.yaml
    // yamlOut: 'spec/api.yaml', // ...or put it somewhere specific
  },
  docs: {
    out: 'docs/index.html',
    ui: 'swagger', // 'swagger' | 'redoc'
  },
  sdk: {
    out: 'sdk',
    baseUrl: 'http://localhost:3000',
    className: 'ApiClient',
  },
});
`;
}

function entryTemplate(routesSpecifier: string): string {
  return `// sdkgen entry point.
//
// The generator imports this module in-process to read the route registry, so
// it MUST be side-effect-free: importing it must not call app.listen(), open a
// database connection, start a timer, or require environment variables.
//
// Import every module that calls createRoute() or router() — importing is what
// populates the shared registry — then re-export the registry itself.
import '${routesSpecifier}';

export { registry } from '@kasdovel/express-sdkgen-core';
`;
}

function routesTemplate(): string {
  return `import { Router } from 'express';
import { z } from 'zod';
import { createRoute } from '@kasdovel/express-sdkgen-core';

// Mount this on your app with \`app.use(routes)\`. Importing the module is what
// registers the routes with sdkgen; mounting is what serves them. For a router
// mounted under a prefix, use \`router('/prefix')\` from the core package so the
// spec and SDK get the full path.
export const routes: Router = Router();

createRoute(routes, {
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  summary: 'Liveness probe',
  // One declaration drives request validation, the spec, the docs and the SDK.
  responses: { 200: z.object({ ok: z.boolean(), uptime: z.number() }) },
  handler: (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  },
});
`;
}

/** Best-effort project name and version for the spec's `info` block. */
async function projectInfo(dir: string): Promise<{ title: string; version: string }> {
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
    const pkg = raw as { name?: unknown; version?: unknown };
    return {
      title: typeof pkg.name === 'string' ? pkg.name : 'My API',
      version: typeof pkg.version === 'string' ? pkg.version : '0.1.0',
    };
  } catch {
    return { title: 'My API', version: '0.1.0' };
  }
}

/**
 * Scaffold a config and a side-effect-free entry module.
 *
 * The entry contract is the one thing a new user gets wrong, and it is easier
 * to show than to describe — so `init` writes a working example rather than a
 * stub. An existing config is never overwritten without `force`; an existing
 * entry or route module is kept, so running this in a real project wires sdkgen
 * up to the code that is already there instead of replacing it.
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const dir = resolve(cwd, options.dir ?? '.');
  const configPath = resolve(dir, options.config ?? 'sdkgen.config.ts');
  const entryPath = resolve(dir, options.entry ?? 'src/openapi.ts');
  const routesPath = resolve(dir, options.routes ?? 'src/routes.ts');

  if (!options.force) {
    const existing = existsSync(configPath) ? configPath : findConfig(dir);
    if (existing) {
      throw new Error(
        `${relative(dir, existing) || existing} already exists — sdkgen is already set up here. ` +
          'Delete it or re-run with --force to overwrite.',
      );
    }
  }

  const { title, version } = await projectInfo(dir);
  const created: string[] = [];
  const kept: string[] = [];

  const write = async (path: string, contents: string) => {
    const label = relative(dir, path) || path;
    if (!options.force && existsSync(path)) {
      kept.push(label);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
    created.push(label);
  };

  // Written in dependency order so the printed list reads top-down.
  await write(routesPath, routesTemplate());
  await write(entryPath, entryTemplate(importSpecifier(entryPath, routesPath)));
  // `entry` is resolved against the config's own directory, not the project
  // root — the two differ as soon as the config is asked for somewhere else.
  const entrySpecifier = relative(dirname(configPath), entryPath).split(sep).join('/');
  await write(configPath, configTemplate(entrySpecifier, title, version));

  return { dir, configPath, entryPath, routesPath, created, kept };
}

/** A config under one of the names the CLI auto-discovers, if there is one. */
function findConfig(dir: string): string | undefined {
  try {
    return resolveConfigPath(dir);
  } catch {
    return undefined;
  }
}
