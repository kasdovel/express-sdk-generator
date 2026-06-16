import { defineConfig } from '@sdkgen/cli';

export default defineConfig({
  entry: 'src/openapi.ts',
  spec: {
    out: 'openapi.json',
    openapi: '3.1',
    title: 'Example API',
    version: '1.0.0',
    yaml: true,
  },
  docs: {
    out: 'docs/index.html',
    ui: 'swagger',
    title: 'Example API',
  },
  sdk: {
    out: 'sdk',
    baseUrl: 'http://localhost:3000',
    className: 'ExampleClient',
  },
});
