import type { IRouter, RequestHandler } from 'express';
import type * as SwaggerUiExpress from 'swagger-ui-express';
import { type Registry, registry as globalRegistry } from './registry.js';
import { buildDocument, type DocumentInfo } from './document.js';

export interface ServeDocsOptions extends DocumentInfo {
  /** Mount path for the UI. Default `/docs`. */
  path?: string;
  /** Registry to render. Defaults to the global registry. */
  registry?: Registry;
  /** Also expose the raw spec JSON. Default `/<path>.json`. */
  specPath?: string;
}

/**
 * Mount live Swagger UI built from the registry. The document is generated
 * fresh on mount, so it always matches the routes currently registered.
 *
 * `swagger-ui-express` is an optional peer dependency; this throws a clear
 * error if it is not installed.
 */
export async function serveDocs(app: IRouter, options: ServeDocsOptions): Promise<void> {
  let swaggerUi: typeof SwaggerUiExpress;
  try {
    swaggerUi = await import('swagger-ui-express');
  } catch {
    throw new Error(
      "serveDocs requires the optional peer dependency 'swagger-ui-express'. " +
        'Install it with `npm i swagger-ui-express`.',
    );
  }

  const reg = options.registry ?? globalRegistry;
  const mountPath = options.path ?? '/docs';
  const specPath = options.specPath ?? `${mountPath}.json`;
  const document = buildDocument(reg, options);

  app.get(specPath, ((_req, res) => {
    res.json(document);
  }) as RequestHandler);

  app.use(mountPath, swaggerUi.serve, swaggerUi.setup(document as Record<string, unknown>));
}
