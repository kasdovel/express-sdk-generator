import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  OpenApiVersion,
  SecurityRequirement,
  SecurityScheme,
} from '@kasdovel/express-sdkgen-core';

export interface SpecConfig {
  /** Output path for the spec. Default `openapi.json`. */
  out?: string;
  openapi?: OpenApiVersion;
  title: string;
  version: string;
  description?: string;
  /** Also write a YAML copy next to the JSON. */
  yaml?: boolean;
  /** Explicit path for the YAML copy. Defaults to `out` with a `.yaml` extension. */
  yamlOut?: string;
  /**
   * Document the 400 response that request-validation middleware can emit for
   * any route declaring `request` schemas. Default `true`; turn it off if your
   * app replaces the default error envelope.
   */
  validationErrors?: boolean;
  servers?: { url: string; description?: string }[];
  /** Named security schemes, emitted as `components.securitySchemes`. */
  securitySchemes?: Record<string, SecurityScheme>;
  /** Document-wide default security requirement; routes can override it. */
  security?: SecurityRequirement[];
}

export interface DocsConfig {
  /** Output HTML path. Default `docs/index.html`. */
  out?: string;
  ui?: 'swagger' | 'redoc';
  title?: string;
  /**
   * Inline the UI assets (JS/CSS) into the HTML instead of loading them from a
   * CDN. Produces a fully offline, air-gapped page at the cost of a larger file.
   * Default `false` (assets loaded from unpkg/jsdelivr at runtime).
   */
  offline?: boolean;
}

export interface SdkConfig {
  /** Output directory. Default `sdk/`. */
  out?: string;
  /** Default base URL baked into the client. Consumers can override. */
  baseUrl?: string;
  /** Generated client class name. Default `ApiClient`. */
  className?: string;
  /**
   * Parse arguments through the operation's request schemas before sending, so
   * a bad call fails locally instead of as a 400. Default `false`.
   */
  validateRequests?: boolean;
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
  throw new Error(`No config file found in ${cwd}. Expected one of: ${CONFIG_NAMES.join(', ')}`);
}
