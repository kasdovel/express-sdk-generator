import type { Registry } from '@kasdovel/express-sdkgen-core';
import { loadRegistry } from './load.js';
import type { SdkgenConfig } from './config.js';

/** The registry handed back by the previous load in this process, if any. */
let previous: Registry | undefined;

/**
 * Load the registry in a way that survives being called more than once.
 *
 * jiti re-executes the *user's* modules on every import (`moduleCache: false`),
 * but `@kasdovel/express-sdkgen-core` resolves to a real package that Node's
 * loader caches — so the global registry the entry re-exports is the same
 * object every time. Re-running `createRoute` against it would hit the
 * duplicate-operationId guard on the second pass, which is exactly what
 * `gen --watch` and `serve` do. Emptying the previous registry first makes a
 * reload produce the same result as a cold start.
 *
 * One process only ever generates for one project, so a single slot is enough
 * — and clearing unconditionally also keeps two projects loaded back to back
 * (as in the test suite) from piling into the same global registry.
 */
export async function reloadRegistry(config: SdkgenConfig, configPath: string): Promise<Registry> {
  const snapshot = previous?.routes.splice(0);

  const registry = await loadRegistry(config, configPath);

  // Same instance, and nothing re-registered into it: the route declarations
  // live somewhere jiti does not re-execute (a linked package, say). Stale
  // routes beat an empty spec, so put them back.
  if (snapshot?.length && registry === previous && registry.routes.length === 0) {
    registry.routes.push(...snapshot);
  }

  previous = registry;
  return registry;
}
