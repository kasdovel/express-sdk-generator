import express from 'express';
import type { Express } from 'express';
import { pathToFileURL } from 'node:url';
import { registry, serveDocs } from '@sdkgen/core';
import { router } from './routes.js';
import { accounts } from './admin.js';

/** Build the Express app (no listen) — used by both `dev` and tests. */
export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(router);
  accounts.mount(app); // mounts the /accounts router (and its /admins sub-router)
  return app;
}

export async function createAppWithDocs(): Promise<Express> {
  const app = createApp();
  await serveDocs(app, {
    registry,
    title: 'Example API',
    version: '1.0.0',
    path: '/docs',
  });
  return app;
}

// Only start a server when run directly (`tsx src/server.ts`), so importing
// this module stays side-effect-free.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const app = await createAppWithDocs();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`Example API on http://localhost:${port}`);
    console.log(`Docs at      http://localhost:${port}/docs`);
  });
}
