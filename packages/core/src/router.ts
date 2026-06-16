import { Router } from 'express';
import type { IRouter } from 'express';
import type { z } from 'zod';
import { Registry, registry as globalRegistry } from './registry.js';
import { registerRoute, type CreateRouteConfig } from './createRoute.js';
import { joinPaths } from './path.js';

export interface ApiRouterOptions {
  /** Bring your own Express router (e.g. to attach middleware). Fresh by default. */
  expressRouter?: Router;
  /** Registry to record into. Defaults to the global registry. */
  registry?: Registry;
}

/**
 * A prefix-aware router. It owns an Express router mounted at a known path:
 * routes added through it register their *local* path on the Express router (so
 * mounting composes normally) but are recorded in the registry under the *full*
 * accumulated path — so the spec and SDK get correct URLs even for routers
 * nested under a prefix. The raw Express router is hidden; mount via `.mount()`.
 *
 *   const accounts = router('/accounts');
 *   accounts.route({ method: 'get', path: '/', operationId: 'listAccounts', ... });
 *   const admins = accounts.router('/admins');   // nested router
 *   admins.route({ method: 'get', path: '/:id', operationId: 'getAdmin', ... });
 *   accounts.mount(app);   // app.use('/accounts', <express router>)
 *   // spec paths: /accounts and /accounts/admins/{id}
 */
export class ApiRouter {
  /** Mount path of this router relative to its parent. */
  readonly localPrefix: string;
  /** Absolute path prefix accumulated from the root. */
  readonly fullPrefix: string;
  private readonly express: Router;
  private readonly registry: Registry;

  constructor(
    localPrefix: string,
    fullPrefix: string,
    express: Router,
    registry: Registry,
  ) {
    this.localPrefix = joinPaths(localPrefix);
    this.fullPrefix = fullPrefix;
    this.express = express;
    this.registry = registry;
  }

  /** Add a route. `config.path` is local to this router. */
  route<
    P extends z.ZodTypeAny | undefined = undefined,
    Q extends z.ZodTypeAny | undefined = undefined,
    B extends z.ZodTypeAny | undefined = undefined,
    H extends z.ZodTypeAny | undefined = undefined,
  >(config: CreateRouteConfig<P, Q, B, H>): this {
    registerRoute(
      this.express,
      config,
      config.registry ?? this.registry,
      joinPaths(this.fullPrefix, config.path),
    );
    return this;
  }

  /** Create a nested router and mount it under `prefix`. */
  router(prefix: string, options: ApiRouterOptions = {}): ApiRouter {
    const child = new ApiRouter(
      prefix,
      joinPaths(this.fullPrefix, prefix),
      options.expressRouter ?? Router(),
      options.registry ?? this.registry,
    );
    this.express.use(child.localPrefix, child.express);
    return child;
  }

  /** Mount this router on a parent app/router at its local prefix. */
  mount(parent: IRouter): void {
    parent.use(this.localPrefix, this.express);
  }
}

/** Create a top-level router whose prefix is also its mount path. */
export function router(
  prefix: string,
  options: ApiRouterOptions = {},
): ApiRouter {
  return new ApiRouter(
    prefix,
    joinPaths(prefix),
    options.expressRouter ?? Router(),
    options.registry ?? globalRegistry,
  );
}
