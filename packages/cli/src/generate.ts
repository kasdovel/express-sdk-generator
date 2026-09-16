import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig } from './load.js';
import { reloadRegistry } from './reload.js';
import { resolveConfigPath, type SdkgenConfig } from './config.js';
import { emitSpec, resolveSpecPaths } from './emitSpec.js';
import { emitDocs } from './emitDocs.js';
import { emitSdk } from './emitSdk.js';

export type Artifact = 'spec' | 'docs' | 'sdk';

export const DEFAULT_DOCS_OUT = 'docs/index.html';
export const DEFAULT_SDK_OUT = 'sdk';

export interface GenerateOptions {
  cwd?: string;
  configPath?: string;
  /** Which artifacts to emit. Default: all configured. */
  only?: Artifact[];
  /**
   * Write every artifact under this directory instead of its configured
   * location, mirroring the project-relative layout. `sdkgen check` uses it to
   * generate a throwaway copy without touching the committed files.
   */
  outDir?: string;
}

export interface GenerateResult {
  /** Absent when the spec was not among the requested artifacts. */
  specPath?: string;
  yamlPath?: string;
  docsPath?: string;
  sdkDir?: string;
}

/** One thing a generation run produces: a file, or the SDK directory. */
export interface ArtifactTarget {
  artifact: Artifact;
  kind: 'file' | 'dir';
  /** Absolute path of the committed artifact. */
  path: string;
  /** `path` relative to the config directory — what the CLI prints. */
  label: string;
}

/**
 * Everything a full `gen all` would write, without writing any of it. The
 * config is the single source of truth for both `generate` and `check`, so
 * neither can drift from the other about where an artifact lives.
 */
export function artifactTargets(config: SdkgenConfig, baseDir: string): ArtifactTarget[] {
  const target = (artifact: Artifact, kind: 'file' | 'dir', path: string): ArtifactTarget => ({
    artifact,
    kind,
    path,
    label: relative(baseDir, path) || basename(path),
  });

  const { jsonPath, yamlPath } = resolveSpecPaths(config.spec, baseDir);
  const targets = [target('spec', 'file', jsonPath)];
  if (yamlPath) targets.push(target('spec', 'file', yamlPath));
  if (config.docs) {
    targets.push(target('docs', 'file', resolve(baseDir, config.docs.out ?? DEFAULT_DOCS_OUT)));
  }
  if (config.sdk) {
    targets.push(target('sdk', 'dir', resolve(baseDir, config.sdk.out ?? DEFAULT_SDK_OUT)));
  }
  return targets;
}

/**
 * The sandbox twin of a committed path: the same project-relative location,
 * rooted under `outDir` and namespaced by artifact so two artifacts that happen
 * to share a filename cannot overwrite each other.
 */
export function sandboxPath(outDir: string, artifact: Artifact, baseDir: string, path: string) {
  const rel = relative(baseDir, path);
  // An output outside the project (or on another root) has no relative shape
  // worth preserving; its name is enough to identify it inside the sandbox.
  const safe = !rel || rel.startsWith('..') || isAbsolute(rel) ? basename(path) : rel;
  return join(outDir, artifact, safe);
}

/** A copy of `config` whose outputs all point inside `outDir`. */
function sandboxConfig(config: SdkgenConfig, baseDir: string, outDir: string): SdkgenConfig {
  const at = (artifact: Artifact, path: string) => sandboxPath(outDir, artifact, baseDir, path);
  const { jsonPath, yamlPath } = resolveSpecPaths(config.spec, baseDir);

  return {
    ...config,
    spec: {
      ...config.spec,
      out: at('spec', jsonPath),
      // Left unset when no YAML copy was configured: `yamlOut` implies one.
      yamlOut: yamlPath ? at('spec', yamlPath) : undefined,
    },
    docs: config.docs && {
      ...config.docs,
      out: at('docs', resolve(baseDir, config.docs.out ?? DEFAULT_DOCS_OUT)),
    },
    sdk: config.sdk && {
      ...config.sdk,
      out: at('sdk', resolve(baseDir, config.sdk.out ?? DEFAULT_SDK_OUT)),
    },
  };
}

/** Load the registry and emit the requested artifacts. */
export async function generate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const loaded: SdkgenConfig = await loadConfig(configPath);
  const registry = await reloadRegistry(loaded, configPath);
  const baseDir = dirname(configPath);
  const config = options.outDir ? sandboxConfig(loaded, baseDir, options.outDir) : loaded;

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
