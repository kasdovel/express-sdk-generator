import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { DocsConfig } from './config.js';

const SWAGGER_VERSION = '5.18.2';
const REDOC_VERSION = '2.2.0';

/** Escape `</script>` so an inlined spec can't break out of the script tag. */
function inlineJson(doc: object): string {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

function swaggerHtml(doc: object, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
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

function redocHtml(doc: object, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body>
  <div id="redoc"></div>
  <script src="https://cdn.jsdelivr.net/npm/redoc@${REDOC_VERSION}/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init(JSON.parse(${JSON.stringify(inlineJson(doc))}), {}, document.getElementById('redoc'));
  </script>
</body>
</html>
`;
}

/** Write self-contained docs HTML (spec inlined, UI from CDN). */
export async function emitDocs(
  document: object,
  docs: DocsConfig,
  cwd: string,
): Promise<string> {
  const title = docs.title ?? 'API Documentation';
  const html =
    (docs.ui ?? 'swagger') === 'redoc'
      ? redocHtml(document, title)
      : swaggerHtml(document, title);

  const out = resolve(cwd, docs.out ?? 'docs/index.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  return out;
}
