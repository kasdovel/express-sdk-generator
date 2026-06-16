import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { OpenApiVersion } from '@sdkgen/core';

export interface SpecConfig {
  /** Output path for the spec. Default `openapi.json`. */
  out?: string;
  openapi?: OpenApiVersion;
  title: string;
  version: string;
  description?: string;
  /** Also write a YAML copy next to the JSON. */
  yaml?: boolean;
  servers?: { url: string; description?: string }[];
}

export interface DocsConfig {
  /** Output HTML path. Default `docs/index.html`. */
  out?: string;
  ui?: 'swagger' | 'redoc';
  title?: string;
}

export interface SdkConfig {
  /** Output directory. Default `sdk/`. */
  out?: string;
  /** Default base URL baked into the client. Consumers can override. */
  baseUrl?: string;
  /** Generated client class name. Default `ApiClient`. */
  className?: string;
}

export interface SdkgenConfig {
  /** Path to a module exporting the populated registry. */
  entry: string;
  /** Named export holding the Registry. Default `registry`. */
  registryExport?: string;
  spec: SpecConfig;
  docs?: DocsConfig;
  sdk?: SdkConfig;
}

/** Identity helper for type-safe config files. */
export function defineConfig(config: SdkgenConfig): SdkgenConfig {
  return config;
}

const CONFIG_NAMES = [
  'sdkgen.config.ts',
  'sdkgen.config.mts',
  'sdkgen.config.js',
  'sdkgen.config.mjs',
  'sdkgen.config.json',
];

/** Resolve the config file path from an explicit value or by convention. */
export function resolveConfigPath(cwd: string, explicit?: string): string {
  if (explicit) {
    const p = resolve(cwd, explicit);
    if (!existsSync(p)) throw new Error(`Config file not found: ${p}`);
    return p;
  }
  for (const name of CONFIG_NAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new Error(
    `No config file found in ${cwd}. Expected one of: ${CONFIG_NAMES.join(', ')}`,
  );
}
