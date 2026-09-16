import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { buildDocument, type Registry } from '@kasdovel/express-sdkgen-core';
import { documentInfo, type SpecConfig } from './config.js';

export interface EmitSpecOptions {
  /**
   * Write the spec to disk. Docs and SDK generation need the document in
   * memory, but `sdkgen gen docs` must not rewrite the spec file behind the
   * user's back. Default `true`.
   */
  write?: boolean;
}

export interface EmitSpecResult {
  document: object;
  /** Absent when `write` was false. */
  jsonPath?: string;
  yamlPath?: string;
}

/** The files `spec` asks for. `yamlPath` is absent when no YAML copy was requested. */
export interface SpecPaths {
  jsonPath: string;
  yamlPath?: string;
}

/**
 * Where the YAML copy goes, or `undefined` when none was asked for.
 *
 * `spec.yamlOut` is the explicit answer. Without it the path is inferred from
 * `spec.out` by swapping the extension, which is why a YAML `spec.out` has to
 * be rejected: the inferred sibling would be the JSON file itself. Setting
 * `yamlOut` also implies `yaml: true` — naming a path and getting no file
 * would be the more surprising reading.
 */
function resolveYamlPath(spec: SpecConfig, cwd: string, jsonPath: string): string | undefined {
  if (!spec.yaml && !spec.yamlOut) return undefined;

  if (spec.yamlOut) {
    const yamlPath = resolve(cwd, spec.yamlOut);
    if (yamlPath === jsonPath) {
      throw new Error(
        `spec.yamlOut "${spec.yamlOut}" resolves to the same file as spec.out — the JSON and ` +
          'YAML outputs would collide. Give them different paths.',
      );
    }
    return yamlPath;
  }

  if (/\.ya?ml$/.test(jsonPath)) {
    throw new Error(
      `spec.out "${spec.out ?? ''}" is a YAML path, but spec.yaml is true — the JSON and ` +
        'YAML outputs would collide. Point spec.out at a .json file (the YAML copy is written ' +
        'next to it), or set spec.yamlOut explicitly.',
    );
  }
  return jsonPath.replace(/\.json$/, '') + '.yaml';
}

/**
 * Resolve the spec's output paths without generating anything. `sdkgen check`
 * needs to know what a run *would* write before it writes it.
 */
export function resolveSpecPaths(spec: SpecConfig, cwd: string): SpecPaths {
  const jsonPath = resolve(cwd, spec.out ?? 'openapi.json');
  return { jsonPath, yamlPath: resolveYamlPath(spec, cwd, jsonPath) };
}

/** Generate the OpenAPI document from the registry, and optionally write it. */
export async function emitSpec(
  registry: Registry,
  spec: SpecConfig,
  cwd: string,
  options: EmitSpecOptions = {},
): Promise<EmitSpecResult> {
  const document = buildDocument(registry, documentInfo(spec));

  if (options.write === false) return { document };

  // Both paths are resolved before anything is written, so a misconfigured pair
  // fails without leaving half a set of artifacts behind.
  const { jsonPath, yamlPath } = resolveSpecPaths(spec, cwd);

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  if (yamlPath) {
    await mkdir(dirname(yamlPath), { recursive: true });
    await writeFile(yamlPath, toYaml(document), 'utf8');
  }

  return { document, jsonPath, yamlPath };
}
