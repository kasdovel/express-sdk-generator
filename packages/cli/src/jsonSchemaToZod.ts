/**
 * Emit Zod *source code* from a JSON Schema (the form embedded in the generated
 * OpenAPI document). Covers the structural subset that matters for catching API
 * drift: objects, arrays, primitives, enums, unions, refs, nullability,
 * required/optional, and common string formats. Refinements/transforms from the
 * original Zod do not round-trip through JSON Schema — structural validation is
 * the goal here.
 */

export interface SchemaContext {
  /** `components.schemas` from the document, for `$ref` resolution. */
  components: Record<string, JsonSchema>;
}

export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  description?: string;
};

function lit(value: unknown): string {
  return JSON.stringify(value);
}

function resolveRef(ref: string, ctx: SchemaContext): JsonSchema | undefined {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (!m) return undefined;
  return ctx.components[m[1]!];
}

function isNullable(schema: JsonSchema): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type)) return schema.type.includes('null');
  return false;
}

function primaryType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== 'null');
  }
  return schema.type;
}

function stringExpr(schema: JsonSchema): string {
  let expr = 'z.string()';
  switch (schema.format) {
    case 'email':
      expr += '.email()';
      break;
    case 'uuid':
      expr += '.uuid()';
      break;
    case 'url':
    case 'uri':
      expr += '.url()';
      break;
    case 'date-time':
      expr += '.datetime({ offset: true })';
      break;
  }
  if (typeof schema.minLength === 'number') expr += `.min(${schema.minLength})`;
  if (typeof schema.maxLength === 'number') expr += `.max(${schema.maxLength})`;
  if (schema.pattern) expr += `.regex(new RegExp(${lit(schema.pattern)}))`;
  return expr;
}

function numberExpr(schema: JsonSchema): string {
  let expr = 'z.number()';
  if (primaryType(schema) === 'integer') expr += '.int()';
  if (typeof schema.minimum === 'number') expr += `.min(${schema.minimum})`;
  if (typeof schema.maximum === 'number') expr += `.max(${schema.maximum})`;
  return expr;
}

function objectExpr(schema: JsonSchema, ctx: SchemaContext, seen: Set<string>): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(props).map(([key, propSchema]) => {
    let expr = toZod(propSchema, ctx, seen);
    if (!required.has(key)) expr += '.optional()';
    return `    ${JSON.stringify(key)}: ${expr},`;
  });
  let expr =
    lines.length > 0
      ? `z.object({\n${lines.join('\n')}\n  })`
      : 'z.object({})';
  if (schema.additionalProperties === false) {
    expr += '.strict()';
  } else if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object'
  ) {
    expr += `.catchall(${toZod(schema.additionalProperties, ctx, seen)})`;
  }
  return expr;
}

/** Convert one JSON Schema node to a Zod expression string. */
export function toZod(
  schema: JsonSchema | undefined,
  ctx: SchemaContext,
  seen: Set<string> = new Set(),
): string {
  if (!schema) return 'z.any()';

  if (schema.$ref) {
    if (seen.has(schema.$ref)) return 'z.any()';
    const target = resolveRef(schema.$ref, ctx);
    if (!target) return 'z.any()';
    const next = new Set(seen);
    next.add(schema.$ref);
    return wrap(schema, toZod(target, ctx, next), false);
  }

  if (schema.const !== undefined) {
    return wrap(schema, `z.literal(${lit(schema.const)})`);
  }
  if (schema.enum) {
    const allStrings = schema.enum.every((v) => typeof v === 'string');
    const expr = allStrings
      ? `z.enum([${schema.enum.map(lit).join(', ')}])`
      : `z.union([${schema.enum.map((v) => `z.literal(${lit(v)})`).join(', ')}])`;
    return wrap(schema, expr);
  }

  if (schema.allOf?.length) {
    const expr = schema.allOf
      .map((s) => toZod(s, ctx, seen))
      .reduce((a, b) => `z.intersection(${a}, ${b})`);
    return wrap(schema, expr);
  }
  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    const expr =
      union.length === 1
        ? toZod(union[0]!, ctx, seen)
        : `z.union([${union.map((s) => toZod(s, ctx, seen)).join(', ')}])`;
    return wrap(schema, expr);
  }

  const type = primaryType(schema);
  let expr: string;
  switch (type) {
    case 'string':
      expr = stringExpr(schema);
      break;
    case 'number':
    case 'integer':
      expr = numberExpr(schema);
      break;
    case 'boolean':
      expr = 'z.boolean()';
      break;
    case 'array':
      expr = `z.array(${toZod(schema.items, ctx, seen)})`;
      break;
    case 'object':
      expr = objectExpr(schema, ctx, seen);
      break;
    case 'null':
      expr = 'z.null()';
      break;
    default:
      expr = schema.properties ? objectExpr(schema, ctx, seen) : 'z.any()';
  }
  return wrap(schema, expr);
}

/** Apply nullable/default modifiers shared across node types. */
function wrap(schema: JsonSchema, expr: string, allowNullable = true): string {
  let out = expr;
  if (allowNullable && isNullable(schema)) out += '.nullable()';
  if (schema.default !== undefined) out += `.default(${lit(schema.default)})`;
  return out;
}
