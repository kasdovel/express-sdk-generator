import type { RouteDef } from './types.js';

/** An operationId becomes a method name in the generated SDK, so it must be a JS identifier. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function where(route: RouteDef): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

/**
 * Holds the canonical list of registered routes. The CLI imports a populated
 * Registry and generates the OpenAPI spec, docs, and SDK from it. Keeping the
 * real Zod schemas (not a serialized form) is what lets the SDK preserve
 * refinements, defaults, and transforms.
 */
export class Registry {
  readonly routes: RouteDef[] = [];

  add(route: RouteDef): void {
    if (!IDENTIFIER.test(route.operationId)) {
      throw new Error(
        `Invalid operationId "${route.operationId}" (${where(route)}). An operationId becomes a ` +
          'method name on the generated SDK client, so it must be a valid JavaScript identifier ' +
          '— letters, digits, `_` or `$`, not starting with a digit (e.g. "getUser").',
      );
    }

    const idClash = this.routes.find((r) => r.operationId === route.operationId);
    if (idClash) {
      throw new Error(
        `Duplicate operationId "${route.operationId}" ` +
          `(${where(idClash)} and ${where(route)}). operationId must be unique.`,
      );
    }

    // Express happily serves two handlers on the same method+path, but OpenAPI
    // keys operations by path+method: the second would silently replace the
    // first in the spec and vanish from the SDK.
    const routeClash = this.routes.find((r) => r.method === route.method && r.path === route.path);
    if (routeClash) {
      throw new Error(
        `Duplicate route ${where(route)} (operationIds "${routeClash.operationId}" and ` +
          `"${route.operationId}"). OpenAPI allows one operation per path + method, so the ` +
          'second would silently overwrite the first in the spec and SDK.',
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
