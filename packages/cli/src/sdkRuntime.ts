/** Static runtime source copied verbatim into the generated SDK (`runtime.ts`). */
export const RUNTIME_SOURCE = `import type { z } from 'zod';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/** One request carried to the server. \`body\` is unserialized; the Transport encodes it. */
export interface TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * What a Transport reports back. \`data\` is already parsed (not raw bytes).
 *
 * \`headers\` is **optional**: a Transport that cannot (or does not care to)
 * report response headers stays valid, and the SDK reports \`{}\` for it. The
 * built-in \`fetch\` adapter always populates it.
 */
export interface TransportResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}

/**
 * A strategy for carrying one request and reporting its status + parsed data.
 * Must resolve with \`{ status, data }\` for HTTP error statuses too — only a true
 * network failure may throw. The SDK owns success/failure and response validation.
 */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** A response with its metadata, returned by the \`…WithResponse\` methods. */
export interface ApiResponse<T> {
  status: number;
  /** Lower-cased response header names. Empty when the Transport reports none. */
  headers: Record<string, string>;
  data: T;
}

/** Built-in default Transport over global \`fetch\`. */
const fetchTransport: Transport = async (req) => {
  const fetchImpl = globalThis.fetch as
    | ((input: string, init?: unknown) => Promise<any>)
    | undefined;
  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation found. Pass { transport } in ClientOptions.',
    );
  }
  const init: Record<string, unknown> = {
    method: req.method,
    headers: req.headers,
    signal: req.signal,
  };
  if (req.body !== undefined) init.body = JSON.stringify(req.body);
  const res = await fetchImpl(req.url, init);
  const text = await res.text();
  return {
    status: res.status,
    data: parseBody(text),
    headers: readHeaders(res.headers),
  };
};

/** Normalize a \`fetch\` \`Headers\` object into a plain lower-cased record. */
function readHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const iterable = headers as
    | { forEach?: (fn: (value: string, key: string) => void) => void }
    | undefined;
  if (iterable && typeof iterable.forEach === 'function') {
    iterable.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value);
    });
  }
  return out;
}

function lowerCaseKeys(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Parse a response body as JSON, falling back to the raw text. A gateway or
 * proxy that answers with HTML must still surface as \`ApiError(status)\`, not as
 * a \`SyntaxError\` from \`JSON.parse\`.
 */
function parseBody(text: string): unknown {
  if (!text.length) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ClientOptions {
  /** Override the base URL baked in at generation time. */
  baseUrl?: string;
  /** Client-wide default Transport. Defaults to the built-in \`fetch\` adapter. */
  transport?: Transport;
  /** Per-HTTP-method Transports; override the default for those methods. */
  transports?: Partial<Record<HttpMethod, Transport>>;
  /** Headers merged into every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Thrown on a non-2xx response. \`body\` is the parsed error payload, if any.
 *
 * The generated client augments {@link ApiErrorBodies} with the schemas the
 * routes declare for each status, so \`isApiError(err, 404)\` narrows \`body\` to
 * the declared 404 shape instead of leaving it \`unknown\`.
 */
export class ApiError<TBody = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly body: TBody,
  ) {
    super(\`Request failed with status \${status}\`);
    this.name = 'ApiError';
  }
}

/**
 * Status code → declared error body. Empty here; the generated \`client.ts\`
 * augments it with one entry per status any route declares an error schema for.
 */
export interface ApiErrorBodies {}

/** The declared body for a status, or \`unknown\` when the API declares none. */
export type ApiErrorBody<S extends number> = S extends keyof ApiErrorBodies
  ? ApiErrorBodies[S]
  : unknown;

/**
 * Narrow a caught value to an {@link ApiError}, optionally to one status.
 *
 * \`\`\`ts
 * try { await api.getUser({ params: { id } }); }
 * catch (err) { if (isApiError(err, 404)) err.body.error; }
 * \`\`\`
 */
export function isApiError(err: unknown): err is ApiError<unknown>;
export function isApiError<S extends number>(
  err: unknown,
  status: S,
): err is ApiError<ApiErrorBody<S>> & { status: S };
export function isApiError(err: unknown, status?: number): boolean {
  return (
    err instanceof ApiError && (status === undefined || err.status === status)
  );
}

export interface RequestArgs {
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: unknown;
  headers?: Record<string, string>;
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, String(v));
    } else {
      sp.append(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? \`?\${s}\` : '';
}

export abstract class BaseClient {
  protected readonly baseUrl: string;
  protected readonly defaultTransport: Transport;
  protected readonly transports: Partial<Record<HttpMethod, Transport>>;
  protected readonly defaultHeaders: Record<string, string>;

  constructor(options: ClientOptions = {}) {
    this.defaultTransport = options.transport ?? fetchTransport;
    this.transports = options.transports ?? {};
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\\/$/, '');
    this.defaultHeaders = options.headers ?? {};
  }

  /** Carry one request and return only the validated body. */
  protected async request<T>(
    method: string,
    pathTemplate: string,
    args: RequestArgs,
    responseSchema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const res = await this.requestWithResponse(
      method,
      pathTemplate,
      args,
      responseSchema,
      options,
    );
    return res.data;
  }

  /**
   * Carry one request and return the validated body *with* its status and
   * headers, for pagination links, \`ETag\`, rate-limit headers and the like.
   * A Transport still only changes delivery: status → \`ApiError\` and response
   * validation happen here either way.
   */
  protected async requestWithResponse<T>(
    method: string,
    pathTemplate: string,
    args: RequestArgs,
    responseSchema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const path = pathTemplate.replace(/\\{(\\w+)\\}/g, (_m, key) => {
      const value = args.params?.[key];
      if (value === undefined || value === null) {
        throw new Error(
          \`Missing path parameter "\${key}" for \${method} \${pathTemplate}.\`,
        );
      }
      return encodeURIComponent(String(value));
    });
    const url = this.baseUrl + path + buildQuery(args.query);

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.defaultHeaders,
    };
    if (args.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, args.headers, options.headers);

    const transport =
      this.transports[method as HttpMethod] ?? this.defaultTransport;
    const res = await transport({
      url,
      method,
      headers,
      body: args.body,
      signal: options.signal,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, res.data);
    }

    // HEAD is defined to carry no body, so there is nothing to validate: the
    // declared response schema describes what the matching GET would return.
    const data =
      method.toUpperCase() === 'HEAD'
        ? (undefined as T)
        : responseSchema.parse(res.data);

    return { status: res.status, headers: lowerCaseKeys(res.headers), data };
  }
}

const DEFAULT_BASE_URL = __DEFAULT_BASE_URL__;
`;
