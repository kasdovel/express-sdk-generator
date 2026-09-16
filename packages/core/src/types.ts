import type { z } from 'zod';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

/** A single status-code response: a Zod schema plus optional description. */
export interface ResponseDef {
  schema: z.ZodTypeAny;
  description?: string;
}

/** Schemas describing an incoming request. All parts optional. */
export interface RequestSchemas {
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
}

/**
 * An OpenAPI Security Scheme Object — how a caller authenticates. Declaration
 * only: `sdkgen` emits these into `components.securitySchemes` so the spec and
 * the docs' "Authorize" button are correct. It never installs auth middleware or
 * touches tokens; enforcing the scheme stays the application's job.
 *
 * @see https://spec.openapis.org/oas/v3.1.0#security-scheme-object
 */
export interface SecurityScheme {
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';
  description?: string;
  /** `apiKey`: the header/query/cookie name carrying the key. */
  name?: string;
  /** `apiKey`: where the key travels. */
  in?: 'query' | 'header' | 'cookie';
  /** `http`: the RFC 7235 scheme, e.g. `bearer` or `basic`. */
  scheme?: string;
  /** `http` + `bearer`: a hint such as `JWT`. */
  bearerFormat?: string;
  /** `oauth2`: the supported flows, verbatim per the OpenAPI spec. */
  flows?: Record<string, unknown>;
  /** `openIdConnect`: the discovery URL. */
  openIdConnectUrl?: string;
}

/**
 * An OpenAPI Security Requirement Object: scheme name → required scopes (empty
 * for schemes that have none). An array means "any one of these satisfies the
 * operation"; `[]` means the operation is explicitly public.
 */
export type SecurityRequirement = Record<string, string[]>;

/**
 * The canonical record for one operation. The registry holds these with the
 * real Zod objects intact — this is the single source of truth that both the
 * OpenAPI spec and the SDK are generated from.
 */
export interface RouteDef {
  method: Method;
  /** Express-style path, e.g. `/users/:id`. */
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  request?: RequestSchemas;
  /** Keyed by HTTP status code. */
  responses: Record<number, ResponseDef>;
  /**
   * Security requirements for this operation. Omit to inherit the document-wide
   * default; pass `[]` to opt this operation out of it (a public login route
   * under an otherwise authenticated API).
   */
  security?: SecurityRequirement[];
}
