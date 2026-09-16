import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { buildDocument, type Registry } from '@kasdovel/express-sdkgen-core';
import type { SpecConfig } from './config.js';

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

/** Generate the OpenAPI document from the registry, and optionally write it. */
export async function emitSpec(
  registry: Registry,
  spec: SpecConfig,
  cwd: string,
  options: EmitSpecOptions = {},
): Promise<EmitSpecResult> {
  const document = buildDocument(registry, {
    title: spec.title,
    version: spec.version,
    description: spec.description,
    openapi: spec.openapi,
    servers: spec.servers,
  });

  if (options.write === false) return { document };

  const jsonPath = resolve(cwd, spec.out ?? 'openapi.json');
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  let yamlPath: string | undefined;
  if (spec.yaml) {
    // `out` names the JSON file; `yaml: true` writes a sibling `.yaml`. A YAML
    // `out` would make the two collide, so say so instead of writing twice.
    if (/\.ya?ml$/.test(jsonPath)) {
      throw new Error(
        `spec.out "${spec.out ?? ''}" is a YAML path, but spec.yaml is true — the JSON and ` +
          'YAML outputs would collide. Point spec.out at a .json file; the YAML copy is ' +
          'written next to it.',
      );
    }
    yamlPath = jsonPath.replace(/\.json$/, '') + '.yaml';
    await writeFile(yamlPath, toYaml(document), 'utf8');
  }

  return { document, jsonPath, yamlPath };
}
