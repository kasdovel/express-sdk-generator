import { dirname } from 'node:path';
import { loadConfig, loadRegistry } from './load.js';
import { resolveConfigPath, type SdkgenConfig } from './config.js';
import { emitSpec } from './emitSpec.js';
import { emitDocs } from './emitDocs.js';
import { emitSdk } from './emitSdk.js';

export type Artifact = 'spec' | 'docs' | 'sdk';

export interface GenerateOptions {
  cwd?: string;
  configPath?: string;
  /** Which artifacts to emit. Default: all configured. */
  only?: Artifact[];
}

export interface GenerateResult {
  /** Absent when the spec was not among the requested artifacts. */
  specPath?: string;
  yamlPath?: string;
  docsPath?: string;
  sdkDir?: string;
}

/** Load the registry and emit the requested artifacts. */
export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const config: SdkgenConfig = await loadConfig(configPath);
  const registry = await loadRegistry(config, configPath);
  const baseDir = dirname(configPath);

  const asked = (a: Artifact) => Boolean(options.only?.includes(a));
  const want = (a: Artifact) => !options.only || options.only.includes(a);

  // The document is always built — docs and sdk derive from it — but it is only
  // written to disk when the spec itself was requested.
  const { document, jsonPath, yamlPath } = await emitSpec(registry, config.spec, baseDir, {
    write: want('spec'),
  });

  const result: GenerateResult = {};
  if (jsonPath) result.specPath = jsonPath;
  if (yamlPath) result.yamlPath = yamlPath;

  if (want('docs')) {
    // Asking for an artifact the config says nothing about is a mistake worth
    // reporting; generating "all" just skips what is not configured.
    if (!config.docs && asked('docs')) {
      throw new Error('`gen docs` needs a "docs" section in the config; none is set.');
    }
    if (config.docs) result.docsPath = await emitDocs(document, config.docs, baseDir);
  }
  if (want('sdk')) {
    if (!config.sdk && asked('sdk')) {
      throw new Error('`gen sdk` needs an "sdk" section in the config; none is set.');
    }
    if (config.sdk) result.sdkDir = await emitSdk(document, config.sdk, baseDir);
  }
  return result;
}
