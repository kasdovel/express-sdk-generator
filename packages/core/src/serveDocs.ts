import type { IRouter, Request, RequestHandler } from 'express';
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
 * Mount live Swagger UI built from the registry. The document is built per
 * request, not at mount time, so routes registered after `serveDocs` runs (a
 * router mounted later in the file, a lazily-imported feature module) still
 * show up instead of silently missing from the docs.
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

  // Rebuilding is cheap next to rendering the UI, and this endpoint is a
  // development affordance — correctness beats caching here.
  const document = (): Record<string, unknown> =>
    buildDocument(reg, options) as Record<string, unknown>;

  app.get(specPath, ((_req, res) => {
    res.json(document());
  }) as RequestHandler);

  const attachDocument: RequestHandler = (req, _res, next) => {
    (req as Request & { swaggerDoc?: unknown }).swaggerDoc = document();
    next();
  };

  app.use(mountPath, attachDocument, swaggerUi.serveFiles(undefined, {}), swaggerUi.setup());
}
