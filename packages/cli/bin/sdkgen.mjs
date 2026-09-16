#!/usr/bin/env node
// Stable entry point for the `sdkgen` binary.
//
// Package managers create the `node_modules/.bin/sdkgen` link at install time.
// In this workspace `dist/` does not exist yet on a fresh `pnpm install`, so
// pointing `bin` straight at `dist/bin.js` leaves the link uncreated and
// `sdkgen` unavailable until a second install. This committed stub always
// exists, so the link is always made and simply forwards to the build output.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require.resolve('../dist/bin.js');
} catch {
  console.error(
    '✗ sdkgen is not built yet (packages/cli/dist/bin.js is missing). Run `pnpm build`.',
  );
  process.exit(1);
}

await import('../dist/bin.js');
