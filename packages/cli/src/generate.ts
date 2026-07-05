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
  specPath: string;
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

  const want = (a: Artifact) => !options.only || options.only.includes(a);

  // Spec is always needed: docs and sdk derive from the generated document.
  const { document, jsonPath } = await emitSpec(registry, config.spec, baseDir);
  const result: GenerateResult = { specPath: jsonPath };

  if (want('docs') && config.docs) {
    result.docsPath = await emitDocs(document, config.docs, baseDir);
  }
  if (want('sdk') && config.sdk) {
    result.sdkDir = await emitSdk(document, config.sdk, baseDir);
  }
  return result;
}
