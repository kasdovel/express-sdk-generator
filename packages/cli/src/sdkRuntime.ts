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

/** What a Transport reports back. \`data\` is already parsed (not raw bytes). */
export interface TransportResponse {
  status: number;
  data: unknown;
}

/**
 * A strategy for carrying one request and reporting its status + parsed data.
 * Must resolve with \`{ status, data }\` for HTTP error statuses too — only a true
 * network failure may throw. The SDK owns success/failure and response validation.
 */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

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
  const data = text.length ? JSON.parse(text) : undefined;
  return { status: res.status, data };
};

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

/** Thrown on a non-2xx response. \`body\` is the parsed JSON payload, if any. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(\`Request failed with status \${status}\`);
    this.name = 'ApiError';
  }
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

  protected async request<T>(
    method: string,
    pathTemplate: string,
    args: RequestArgs,
    responseSchema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const path = pathTemplate.replace(/\\{(\\w+)\\}/g, (_m, key) =>
      encodeURIComponent(String(args.params?.[key])),
    );
    const url = this.baseUrl + path + buildQuery(args.query);

    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (args.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, args.headers, options.headers);

    const transport =
      this.transports[method as HttpMethod] ?? this.defaultTransport;
    const { status, data } = await transport({
      url,
      method,
      headers,
      body: args.body,
      signal: options.signal,
    });

    if (status < 200 || status >= 300) throw new ApiError(status, data);
    return responseSchema.parse(data);
  }
}

const DEFAULT_BASE_URL = __DEFAULT_BASE_URL__;
`;
