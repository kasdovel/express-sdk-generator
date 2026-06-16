/**
 * Convert an Express-style path (`/users/:id`) to an OpenAPI-style path
 * template (`/users/{id}`).
 */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Join path segments into one absolute path, collapsing duplicate slashes and
 * dropping a trailing slash (except for the root `/`).
 *   joinPaths('/users', '/')      -> '/users'
 *   joinPaths('/users', '/:id')   -> '/users/:id'
 *   joinPaths('/a/', '', '/b')    -> '/a/b'
 */
export function joinPaths(...parts: string[]): string {
  const joined = ('/' + parts.join('/')).replace(/\/+/g, '/');
  if (joined === '/') return '/';
  return joined.replace(/\/+$/, '') || '/';
}

/** List the `:param` names in an Express-style path, in order. */
export function pathParamNames(expressPath: string): string[] {
  const names: string[] = [];
  const re = /:([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expressPath)) !== null) {
    names.push(m[1]!);
  }
  return names;
}
