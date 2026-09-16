import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { loadConfig } from './load.js';
import { reloadRegistry } from './reload.js';
import { documentInfo, resolveConfigPath, type SdkgenConfig } from './config.js';
import { buildDocument } from '@kasdovel/express-sdkgen-core';
import { escapeHtml } from './emitDocs.js';
import { watchSources } from './watch.js';

const SWAGGER_VERSION = '5.18.2';

/** Where the browser subscribes for reload pings. Namespaced to not shadow a real path. */
const RELOAD_PATH = '/__sdkgen/reload';
const SPEC_PATH = '/openapi.json';

function page(specUrl: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"/></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
<script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui' });</script>
<script>
// Server-sent reload: the watcher rebuilds the document, the page follows.
try {
  new EventSource(${JSON.stringify(RELOAD_PATH)}).addEventListener('reload', function () {
    location.reload();
  });
} catch (e) {}
</script>
</body></html>`;
}

export interface ServeOptions {
  cwd?: string;
  configPath?: string;
  /** `0` binds an ephemeral port; read the real one from the handle. */
  port?: number;
  /** Suppress the startup and rebuild log lines. Default `false`. */
  quiet?: boolean;
  debounceMs?: number;
}

export interface ServeHandle {
  readonly port: number;
  readonly url: string;
  /** Current document build number; bumps on every successful rebuild. */
  readonly version: number;
  close(): Promise<void>;
}

/** The last build: a document to serve, or the error to show instead. */
type Build = { ok: true; document: object } | { ok: false; message: string };

async function buildOnce(config: SdkgenConfig, configPath: string): Promise<Build> {
  try {
    const registry = await reloadRegistry(config, configPath);
    return {
      ok: true,
      document: buildDocument(registry, documentInfo(config.spec)),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Serve live docs from the registry, rebuilding when the sources change.
 *
 * The document is cached between requests. Re-importing the entry module on
 * every request — including the request for the HTML shell — is affordable for
 * a three-route example and not for a real app, so the file watcher, not the
 * request, is what invalidates the build.
 */
export async function serve(options: ServeOptions = {}): Promise<ServeHandle> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  const config = await loadConfig(configPath);
  const baseDir = dirname(configPath);
  const port = options.port ?? 4000;
  const log = (line: string) => {
    if (!options.quiet) console.log(line);
  };

  let build = await buildOnce(config, configPath);
  let version = 1;
  if (!build.ok) log(`✗ ${build.message}`);

  // SSE subscribers. Held so a rebuild can push, and so close() can end them —
  // an open event stream would otherwise keep the server from shutting down.
  const subscribers = new Set<ServerResponse>();

  const rebuild = async (trigger: string): Promise<void> => {
    build = await buildOnce(config, configPath);
    version++;
    log(
      build.ok
        ? `↻ rebuilt from ${trigger} (v${String(version)})`
        : `✗ ${build.message} (from ${trigger})`,
    );
    for (const res of subscribers) {
      res.write(`event: reload\ndata: ${String(version)}\n\n`);
    }
  };

  const sources = watchSources(config, configPath, {
    debounceMs: options.debounceMs,
    onChange: (path) => void rebuild(path),
  });

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = (req.url ?? '/').split('?')[0];

    if (url === RELOAD_PATH) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`retry: 1000\n\n`);
      subscribers.add(res);
      req.on('close', () => subscribers.delete(res));
      return;
    }

    if (url === SPEC_PATH) {
      if (!build.ok) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(build.message);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(build.document));
      return;
    }

    // The shell renders even while the build is broken, so the reload stream
    // stays connected and the page recovers on its own once the entry is fixed.
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(page(SPEC_PATH, config.docs?.title ?? config.spec.title));
  };

  const server: Server = createServer(handle);
  await new Promise<void>((ready) => server.listen(port, ready));

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://localhost:${String(actualPort)}`;
  log(`Docs preview on ${url} (cwd: ${baseDir}) — watching for changes`);

  return {
    port: actualPort,
    url,
    get version() {
      return version;
    },
    async close() {
      sources.close();
      for (const res of subscribers) res.end();
      subscribers.clear();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
