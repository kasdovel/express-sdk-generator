# @kasdovel/express-sdkgen-cli

The generator CLI for `sdkgen` that builds OpenAPI specs, interactive documentation, and fully-typed TypeScript SDKs from your Express route registry.

## Installation

```bash
npm install -D @kasdovel/express-sdkgen-cli
# or
pnpm add -D @kasdovel/express-sdkgen-cli
# or
yarn add -D @kasdovel/express-sdkgen-cli
```

## Setup & Configuration

Create a file named `sdkgen.config.ts` at the root of your project:

```typescript
import { defineConfig } from '@kasdovel/express-sdkgen-cli';

export default defineConfig({
  entry: 'src/openapi.ts', // Entrypoint that populates the registry
  spec: {
    out: 'openapi.json', // Spec output path
    openapi: '3.1', // OpenAPI version ('3.0' | '3.1'), default '3.1'
    title: 'My Express API',
    version: '1.0.0',
    yaml: false, // Also write a YAML copy next to the JSON
  },
  docs: {
    out: 'docs/index.html',
    ui: 'swagger', // 'swagger' | 'redoc'
    offline: false, // Inlines Swagger/Redoc UI bundle for offline use
  },
  sdk: {
    out: 'sdk', // Directory where SDK files will be written
    baseUrl: 'https://api.example.com',
    className: 'ApiClient',
  },
});
```

### Exposing the Registry Entrypoint

The entrypoint specified in your config (`entry`) must be side-effect-free (e.g. no DB connection starts or calling `app.listen()`), as it is imported by the CLI at build time to read the route registry.

```typescript
// src/openapi.ts
import './routes.js'; // Imports the routes to populate the registry
export { registry } from '@kasdovel/express-sdkgen-core';
```

## CLI Commands

You can run `sdkgen` using `npx`, `pnpm exec`, or `yarn run`:

### Generate all artifacts

Generate the spec, docs, and SDK all at once:

```bash
npx sdkgen gen all
```

### Generate a single artifact

```bash
# Generate only the OpenAPI spec
npx sdkgen gen spec

# Generate only the TypeScript SDK
npx sdkgen gen sdk
```

Each subcommand writes only what it names: `gen sdk` never rewrites your
`openapi.json`, and asking for an artifact your config has no section for is an
error rather than a silent no-op.

### Live Preview API Docs

Start a hot-reloading development server to preview your API docs:

```bash
npx sdkgen serve
```

## Troubleshooting

Failures print a single line (`✗ …`) and exit non-zero. For the underlying
stack trace — useful when your entry module itself fails to import — set
`SDKGEN_DEBUG=1`:

```bash
SDKGEN_DEBUG=1 npx sdkgen gen all
```

Common messages:

| Message                               | Fix                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `No config file found in …`           | Create `sdkgen.config.ts`, or pass `-c path/to/config.ts`.                  |
| `Entry "…" did not export a Registry` | Make the entry import your route modules and re-export `registry`.          |
| `declares path parameter ":id" but …` | Add the parameter to `request.params` so the spec and SDK can fill the URL. |
| `Duplicate route GET /users`          | Two operations share a method + path; OpenAPI allows only one.              |

## License

MIT
