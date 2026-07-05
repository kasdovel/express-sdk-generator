import type { RouteDef } from './types.js';

/**
 * Holds the canonical list of registered routes. The CLI imports a populated
 * Registry and generates the OpenAPI spec, docs, and SDK from it. Keeping the
 * real Zod schemas (not a serialized form) is what lets the SDK preserve
 * refinements, defaults, and transforms.
 */
export class Registry {
  readonly routes: RouteDef[] = [];

  add(route: RouteDef): void {
    const clash = this.routes.find((r) => r.operationId === route.operationId);
    if (clash) {
      throw new Error(
        `Duplicate operationId "${route.operationId}" ` +
          `(${clash.method.toUpperCase()} ${clash.path} and ` +
          `${route.method.toUpperCase()} ${route.path}). operationId must be unique.`,
      );
    }
    this.routes.push(route);
  }
}

/** Default global registry used when `createRoute` is called without one. */
export const registry = new Registry();

/** Create an isolated registry (useful for tests or multiple apps). */
export function createRegistry(): Registry {
  return new Registry();
}
