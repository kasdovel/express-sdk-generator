import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { buildDocument, type Registry } from '@kasdovel/express-sdkgen-core';
import type { SpecConfig } from './config.js';

export interface EmitSpecResult {
  document: object;
  jsonPath: string;
  yamlPath?: string;
}

/** Generate the OpenAPI document from the registry and write it to disk. */
export async function emitSpec(
  registry: Registry,
  spec: SpecConfig,
  cwd: string,
): Promise<EmitSpecResult> {
  const document = buildDocument(registry, {
    title: spec.title,
    version: spec.version,
    description: spec.description,
    openapi: spec.openapi,
    servers: spec.servers,
  });

  const jsonPath = resolve(cwd, spec.out ?? 'openapi.json');
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  let yamlPath: string | undefined;
  if (spec.yaml) {
    yamlPath = jsonPath.replace(/\.json$/, '') + '.yaml';
    await writeFile(yamlPath, toYaml(document), 'utf8');
  }

  return { document, jsonPath, yamlPath };
}
