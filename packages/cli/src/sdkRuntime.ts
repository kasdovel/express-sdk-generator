/** Static runtime source copied verbatim into the generated SDK (`runtime.ts`). */
export const RUNTIME_SOURCE = `import type { z } from 'zod';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface ClientOptions {
  /** Override the base URL baked in at generation time. */
  baseUrl?: string;
  /** Fetch-compatible transport. Defaults to global \`fetch\`. */
  fetch?: FetchLike;
  /** Headers merged into every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: unknown;
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
  protected readonly fetchImpl: FetchLike;
  protected readonly defaultHeaders: Record<string, string>;

  constructor(options: ClientOptions = {}) {
    const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (!fetchImpl) {
      throw new Error(
        'No fetch implementation found. Pass { fetch } in ClientOptions.',
      );
    }
    this.fetchImpl = fetchImpl;
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
    let body: string | undefined;
    if (args.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(args.body);
    }
    Object.assign(headers, args.headers, options.headers);

    const res = await this.fetchImpl(url, { method, headers, body });
    const text = await res.text();
    const payload = text.length ? JSON.parse(text) : undefined;

    if (!res.ok) throw new ApiError(res.status, payload);
    return responseSchema.parse(payload);
  }
}

const DEFAULT_BASE_URL = __DEFAULT_BASE_URL__;
`;
