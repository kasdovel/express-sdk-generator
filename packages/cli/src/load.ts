import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import type { Registry } from '@sdkgen/core';
import type { SdkgenConfig } from './config.js';

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

function pickDefault<T>(mod: Record<string, unknown>): T {
  const m = mod as { default?: unknown };
  return (m.default ?? mod) as T;
}

/** Load and validate a config module (TS/JS/JSON) via jiti. */
export async function loadConfig(configPath: string): Promise<SdkgenConfig> {
  const mod = await jiti.import<Record<string, unknown>>(
    pathToFileURL(configPath).href,
  );
  const config = pickDefault<SdkgenConfig>(mod);
  if (!config || typeof config.entry !== 'string') {
    throw new Error(
      `Config at ${configPath} must export an object with an "entry" string ` +
        '(default export or named).',
    );
  }
  return config;
}

function looksLikeRegistry(value: unknown): value is Registry {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { routes?: unknown }).routes)
  );
}

/**
 * Import the entry module and return the populated Registry. The entry must be
 * side-effect-free (no `app.listen`, no DB connect) — it is imported in-process.
 */
export async function loadRegistry(
  config: SdkgenConfig,
  configPath: string,
): Promise<Registry> {
  const entryPath = resolve(dirname(configPath), config.entry);
  const mod = await jiti.import<Record<string, unknown>>(
    pathToFileURL(entryPath).href,
  );

  const exportName = config.registryExport ?? 'registry';
  const candidate =
    mod[exportName] ??
    (mod.default as Record<string, unknown> | undefined)?.[exportName] ??
    mod.default;

  if (!looksLikeRegistry(candidate)) {
    throw new Error(
      `Entry "${config.entry}" did not export a Registry as "${exportName}" ` +
        '(nor as a default). Make sure the entry imports your route modules so ' +
        'the registry is populated, and exports it.',
    );
  }
  return candidate;
}
