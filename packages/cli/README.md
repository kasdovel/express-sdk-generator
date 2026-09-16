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
    // yamlOut: 'openapi.yaml',      // explicit path for the YAML copy
    // validationErrors: true,       // document the 400 request validation emits (default)
    // securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    // security: [{ bearer: [] }],   // document-wide default
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
    // validateRequests: false,      // parse arguments client-side before sending
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

| Command                               | What it does                                                      |
| ------------------------------------- | ----------------------------------------------------------------- |
| `sdkgen init [dir]`                   | Scaffold a config, a side-effect-free entry, and an example route |
| `sdkgen gen [all\|spec\|docs\|sdk]`   | Generate artifacts; `-w/--watch` regenerates on change            |
| `sdkgen check [all\|spec\|docs\|sdk]` | Fail if committed artifacts differ from a fresh generation        |
| `sdkgen serve`                        | Live docs preview that reloads when your routes change            |

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

### Regenerate on change

```bash
npx sdkgen gen all --watch
```

Watches the entry module and everything it imports, debounces, and reports each
regeneration. Ctrl-C stops it.

### Fail CI on stale artifacts

```bash
npx sdkgen check          # everything the config declares
npx sdkgen check sdk      # just the SDK
```

`check` regenerates into a temporary directory and compares the result against
what is committed. It prints the files that differ with a unified diff and exits
1, so a route change that was never regenerated cannot reach `master`:

```yaml
- run: npx sdkgen check
```

### Scaffold a new project

```bash
npx sdkgen init                 # into the current directory
npx sdkgen init api --force     # into ./api, overwriting what is there
```

Writes `sdkgen.config.ts`, `src/openapi.ts` and `src/routes.ts` — the entry
contract is the part everyone gets wrong, so the scaffold demonstrates it. Paths
are overridable (`-c`, `-e`, `-r`), and existing files are never clobbered
without `--force`.

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
