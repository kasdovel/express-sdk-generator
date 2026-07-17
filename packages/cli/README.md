# @sdkgen/cli

The generator CLI for `sdkgen` that builds OpenAPI specs, interactive documentation, and fully-typed TypeScript SDKs from your Express route registry.

## Installation

```bash
npm install -D @sdkgen/cli
# or
pnpm add -D @sdkgen/cli
# or
yarn add -D @sdkgen/cli
```

## Setup & Configuration

Create a file named `sdkgen.config.ts` at the root of your project:

```typescript
import { defineConfig } from '@sdkgen/cli';

export default defineConfig({
  entry: 'src/openapi.ts', // Entrypoint that populates the registry
  spec: {
    out: 'openapi.json', // Spec output path
    openapi: '3.1.0', // OpenAPI version ('3.0.0' | '3.1.0')
    title: 'My Express API',
    version: '1.0.0',
    yaml: false, // Emit YAML instead of JSON
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
export { registry } from '@sdkgen/core';
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

### Live Preview API Docs

Start a hot-reloading development server to preview your API docs:

```bash
npx sdkgen serve
```

## License

MIT
