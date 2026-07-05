import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { DocsConfig } from './config.js';

const SWAGGER_VERSION = '5.18.2';
const REDOC_VERSION = '2.2.0';

const require = createRequire(import.meta.url);

/** Read a file shipped inside an installed npm package (respecting its layout). */
async function readPackageFile(pkg: string, ...rel: string[]): Promise<string> {
  const pkgRoot = dirname(require.resolve(`${pkg}/package.json`));
  return readFile(join(pkgRoot, ...rel), 'utf8');
}

/** Escape `</script>` so an inlined spec can't break out of the script tag. */
function inlineJson(doc: object): string {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

/** Neutralize a closing tag in inlined asset text so it can't end the element early. */
function inlineAsset(source: string): string {
  return source.replace(/<\/(script|style)/gi, '<\\/$1');
}

interface SwaggerAssets {
  css: string;
  js: string;
}

function swaggerHead(title: string, assets?: SwaggerAssets): string {
  const style = assets
    ? `  <style>${inlineAsset(assets.css)}</style>`
    : `  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />`;
  return `  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
${style}`;
}

function swaggerHtml(doc: object, title: string, assets?: SwaggerAssets): string {
  const script = assets
    ? `  <script>${inlineAsset(assets.js)}</script>`
    : `  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>`;
  return `<!doctype html>
<html lang="en">
<head>
${swaggerHead(title, assets)}
</head>
<body>
  <div id="swagger-ui"></div>
${script}
  <script>
    window.ui = SwaggerUIBundle({
      spec: JSON.parse(${JSON.stringify(inlineJson(doc))}),
      dom_id: '#swagger-ui',
    });
  </script>
</body>
</html>
`;
}

function redocHtml(doc: object, title: string, js?: string): string {
  const script = js
    ? `  <script>${inlineAsset(js)}</script>`
    : `  <script src="https://cdn.jsdelivr.net/npm/redoc@${REDOC_VERSION}/bundles/redoc.standalone.js"></script>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body>
  <div id="redoc"></div>
${script}
  <script>
    Redoc.init(JSON.parse(${JSON.stringify(inlineJson(doc))}), {}, document.getElementById('redoc'));
  </script>
</body>
</html>
`;
}

async function renderSwagger(
  document: object,
  title: string,
  offline: boolean,
): Promise<string> {
  if (!offline) return swaggerHtml(document, title);
  const [css, js] = await Promise.all([
    readPackageFile('swagger-ui-dist', 'swagger-ui.css'),
    readPackageFile('swagger-ui-dist', 'swagger-ui-bundle.js'),
  ]);
  return swaggerHtml(document, title, { css, js });
}

async function renderRedoc(
  document: object,
  title: string,
  offline: boolean,
): Promise<string> {
  if (!offline) return redocHtml(document, title);
  const js = await readPackageFile('redoc', 'bundles', 'redoc.standalone.js');
  return redocHtml(document, title, js);
}

/**
 * Write docs HTML with the spec inlined. By default the UI is loaded from a CDN;
 * with `offline: true` the UI assets are vendored into the file too.
 */
export async function emitDocs(
  document: object,
  docs: DocsConfig,
  cwd: string,
): Promise<string> {
  const title = docs.title ?? 'API Documentation';
  const offline = docs.offline ?? false;
  const html =
    (docs.ui ?? 'swagger') === 'redoc'
      ? await renderRedoc(document, title, offline)
      : await renderSwagger(document, title, offline);

  const out = resolve(cwd, docs.out ?? 'docs/index.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  return out;
}
