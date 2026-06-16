import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { loadConfig, loadRegistry } from './load.js';
import { resolveConfigPath } from './config.js';
import { buildDocument } from '@sdkgen/core';

const SWAGGER_VERSION = '5.18.2';

function page(specUrl: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${title}</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"/></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
<script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui' });</script>
</body></html>`;
}

export interface ServeOptions {
  cwd?: string;
  configPath?: string;
  port?: number;
}

/** Serve live docs built from the registry on each spec request. */
export async function serve(options: ServeOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const config = await loadConfig(configPath);
  const baseDir = dirname(configPath);
  const port = options.port ?? 4000;

  const server = createServer(async (req, res) => {
    try {
      // Re-import the registry each request so edits are reflected on reload.
      const registry = await loadRegistry(config, configPath);
      if (req.url === '/openapi.json') {
        const doc = buildDocument(registry, {
          title: config.spec.title,
          version: config.spec.version,
          description: config.spec.description,
          openapi: config.spec.openapi,
          servers: config.spec.servers,
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(doc));
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(page('/openapi.json', config.docs?.title ?? config.spec.title));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err instanceof Error ? err.message : err));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Docs preview on http://localhost:${port} (cwd: ${baseDir})`);
}
