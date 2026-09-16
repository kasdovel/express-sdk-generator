/**
 * Emit Zod *source code* from a JSON Schema (the form embedded in the generated
 * OpenAPI document). Covers the structural subset that matters for catching API
 * drift: objects, arrays, primitives, enums, unions, refs, nullability,
 * required/optional, numeric/array/string bounds, and common string formats.
 * Refinements/transforms from the original Zod do not round-trip through JSON
 * Schema — structural validation is the goal here.
 *
 * Two rules keep the emitter from degrading silently (see the 2026-09-16 review):
 *
 * - A keyword that genuinely cannot be represented produces a
 *   {@link ConversionNote}. The caller renders it as a `// sdkgen: unsupported …`
 *   comment in the generated file, so the loss shows up in a diff rather than in
 *   production.
 * - `$ref`s resolve to a **named const** via {@link SharedSchemas} instead of
 *   being inlined, and a `$ref` cycle becomes `z.lazy()` instead of `z.any()`.
 */

import { createHash } from 'node:crypto';

export interface SchemaContext {
  /** `components.schemas` from the document, for `$ref` resolution. */
  components: Record<string, JsonSchema>;
  /**
   * Sink for hoisted declarations. When present, `$ref`s become named consts and
   * structurally identical inline schemas are deduplicated into shared consts.
   * Without it every schema is inlined (and a `$ref` cycle is unrepresentable).
   */
  shared?: SharedSchemas;
  /** Sink for keywords that could not be represented. */
  notes?: ConversionNote[];
}

/** One keyword the emitter could not represent, and where it was found. */
export interface ConversionNote {
  /** JSON-pointer-ish location inside the schema being converted. */
  path: string;
  keyword: string;
  message: string;
}

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  description?: string;
}

/** Render a note as the comment line that goes above the generated const. */
export function formatNote(note: ConversionNote): string {
  return `// sdkgen: unsupported ${note.keyword} at ${note.path} — ${note.message}`;
}

/**
 * Keywords with no Zod equivalent in the structural subset. Present-but-ignored
 * means the generated schema is *more permissive* than the document, so each one
 * is reported rather than dropped on the floor.
 */
const UNSUPPORTED_KEYWORDS: Record<string, string> = {
  not: 'the negated schema is not checked',
  if: 'conditional subschemas are not checked',
  then: 'conditional subschemas are not checked',
  else: 'conditional subschemas are not checked',
  patternProperties: 'pattern-keyed properties are not checked',
  propertyNames: 'property names are not checked',
  dependentRequired: 'conditional required-property rules are not checked',
  dependentSchemas: 'conditional subschemas are not checked',
  dependencies: 'conditional required-property rules are not checked',
  contains: 'array containment is not checked',
  minContains: 'array containment is not checked',
  maxContains: 'array containment is not checked',
  prefixItems: 'positional (tuple) item schemas are not checked',
  unevaluatedProperties: 'unevaluated properties are not checked',
  unevaluatedItems: 'unevaluated items are not checked',
  minProperties: 'the minimum property count is not checked',
  maxProperties: 'the maximum property count is not checked',
};

/** String `format` values Zod can express, mapped to the method that does it. */
const STRING_FORMATS: Record<string, string> = {
  email: '.email()',
  uuid: '.uuid()',
  url: '.url()',
  uri: '.url()',
  'date-time': '.datetime({ offset: true })',
  date: '.date()',
  time: '.time()',
  duration: '.duration()',
  ipv4: ".ip({ version: 'v4' })",
  ipv6: ".ip({ version: 'v6' })",
  cuid: '.cuid()',
  cuid2: '.cuid2()',
  ulid: '.ulid()',
};

/** Formats that describe an encoding rather than a value constraint. */
const IGNORED_STRING_FORMATS = new Set(['binary', 'byte', 'password']);

/** Keys that carry documentation only — two schemas differing only here are one. */
const ANNOTATION_KEYS = new Set([
  'description',
  'title',
  'example',
  'examples',
  'externalDocs',
  'deprecated',
  'readOnly',
  'writeOnly',
  '$comment',
  '$schema',
  '$id',
]);

interface Decl {
  key: string;
  name: string;
  expr: string;
  /** Part of a `$ref` cycle, so it must be `z.lazy()` to avoid a TDZ error. */
  lazy: boolean;
  /** Named by a `components.schemas` entry rather than by its structure hash. */
  fromComponent: boolean;
  notes: ConversionNote[];
}

/**
 * The table of hoisted schema consts for one generated `schemas.ts`.
 *
 * A `$ref` becomes a const named after the component; a structure that appears
 * two or more times becomes a const named after a hash of that structure, so the
 * name is stable across runs (an ordinal would renumber every later const as
 * soon as one schema is added). Declarations come out in dependency order.
 */
export class SharedSchemas {
  private readonly components: Record<string, JsonSchema>;
  private readonly taken = new Set<string>();
  private readonly byKey = new Map<string, Decl>();
  private readonly order: Decl[] = [];
  private readonly stack: Decl[] = [];
  private readonly counts = new Map<string, number>();
  /** Structure of a component body → the `$ref` that names it. */
  private readonly structureToRef = new Map<string, string>();

  constructor(components: Record<string, JsonSchema> = {}, reserved: Iterable<string> = []) {
    this.components = components;
    for (const name of reserved) this.taken.add(name);
  }

  /** Reserve a name the generated file uses for something else. */
  reserve(name: string): void {
    this.taken.add(name);
  }

  /**
   * Count how often each structure occurs across the document, so the converter
   * can hoist the repeats and leave one-off shapes inline. Components are always
   * named, so their bodies are registered rather than counted.
   */
  plan(roots: Iterable<JsonSchema | undefined>): void {
    for (const [name, body] of Object.entries(this.components)) {
      this.structureToRef.set(structuralKey(body), `#/components/schemas/${name}`);
    }
    const visited = new Set<string>();
    const walk = (schema: JsonSchema | undefined): void => {
      if (!schema) return;
      if (schema.$ref) {
        if (visited.has(schema.$ref)) return;
        visited.add(schema.$ref);
        walk(resolveRef(schema.$ref, this.components));
        return;
      }
      if (hoistable(schema)) {
        const key = structuralKey(schema);
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      }
      for (const child of childSchemas(schema)) walk(child);
    };
    for (const root of roots) walk(root);
  }

  /** Where notes belong right now: the decl being built, or the caller's sink. */
  get noteSink(): ConversionNote[] | undefined {
    return this.stack.length ? this.stack[this.stack.length - 1]!.notes : undefined;
  }

  /** The `$ref` that names this structure, if a component already does. */
  refForStructure(key: string): string | undefined {
    return this.structureToRef.get(key);
  }

  /** Whether an inline structure occurs often enough to be worth hoisting. */
  shouldHoist(key: string): boolean {
    return (this.counts.get(key) ?? 0) >= 2;
  }

  /**
   * Return the const name for `key`, building it with `build` on first sight.
   * Re-entering a key that is still being built is a cycle: every declaration on
   * the stack from that key upwards is marked `lazy`.
   */
  declare(key: string, preferredName: string, build: () => string): string {
    const existing = this.byKey.get(key);
    if (existing) {
      const at = this.stack.indexOf(existing);
      if (at >= 0) for (const decl of this.stack.slice(at)) decl.lazy = true;
      return existing.name;
    }
    const decl: Decl = {
      key,
      name: this.uniqueName(preferredName),
      expr: '',
      lazy: false,
      fromComponent: key.startsWith('ref:'),
      notes: [],
    };
    this.byKey.set(key, decl);
    this.stack.push(decl);
    try {
      decl.expr = build();
    } finally {
      this.stack.pop();
    }
    this.order.push(decl);
    return decl.name;
  }

  /** The hoisted consts, in dependency order, ready to write to `schemas.ts`. */
  declarations(): string[] {
    return this.order.map((decl) => {
      const lines = decl.notes.map(formatNote);
      if (decl.lazy) {
        lines.push(
          `// sdkgen: recursive schema — validation is preserved via z.lazy(), but`,
          `// z.infer<typeof ${decl.name}> widens to \`any\`. Declare the type by hand if you need it.`,
          `export const ${decl.name}: z.ZodType<any> = z.lazy(() => ${decl.expr});`,
        );
      } else {
        lines.push(`export const ${decl.name} = ${decl.expr};`);
      }
      return lines.join('\n');
    });
  }

  /** The names of the hoisted consts, in declaration order. */
  names(): string[] {
    return this.order.map((decl) => decl.name);
  }

  /**
   * The hoisted consts that a `components.schemas` entry named — i.e. the ones
   * a user earned by tagging a schema with `.openapi('Name')`. These are the
   * only shared names worth re-exporting as SDK types; a structure-hashed name
   * is an implementation detail of deduplication.
   */
  componentNames(): string[] {
    return this.order.filter((decl) => decl.fromComponent).map((decl) => decl.name);
  }

  private uniqueName(preferred: string): string {
    const base = identifier(preferred);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let i = 2; ; i++) {
      const candidate = `${base}_${i}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }
}

interface Walk {
  ctx: SchemaContext;
  path: string;
  indent: number;
  /**
   * `$ref`s currently being inlined. Only used when there is no
   * {@link SharedSchemas} to hoist into — with one, `declare` detects the cycle
   * and emits `z.lazy()` instead.
   */
  refStack: string[];
}

export interface ToZodOptions {
  /** Column the expression's continuation lines are indented from. Default 0. */
  indent?: number;
  /** Location prefix used when reporting unsupported keywords. Default `#`. */
  path?: string;
}

/** Convert one JSON Schema node to a Zod expression string. */
export function toZod(
  schema: JsonSchema | undefined,
  ctx: SchemaContext,
  options: ToZodOptions = {},
): string {
  return convert(schema, {
    ctx,
    path: options.path ?? '#',
    indent: options.indent ?? 0,
    refStack: [],
  });
}

/** Convert a node, hoisting it into a shared const when that applies. */
function convert(schema: JsonSchema | undefined, w: Walk): string {
  if (!schema) return 'z.any()';

  const shared = w.ctx.shared;
  if (shared && !schema.$ref && hoistable(schema)) {
    const key = structuralKey(schema);
    // An inline copy of a named component resolves to that component's const.
    const ref = shared.refForStructure(key);
    if (ref) {
      reportUnsupported(schema, w);
      return wrap(schema, refExpr(ref, w), false);
    }
    if (shared.shouldHoist(key)) {
      return shared.declare(`inline:${key}`, structuralName(key), () =>
        convertNode(schema, { ...w, indent: 0 }),
      );
    }
  }

  return convertNode(schema, w);
}

/** Convert a node in place — the hoist decision has already been made. */
function convertNode(schema: JsonSchema, w: Walk): string {
  reportUnsupported(schema, w);
  if (schema.$ref) return wrap(schema, refExpr(schema.$ref, w), false);
  return wrap(schema, build(schema, w));
}

/** The expression for a node, before nullable/default modifiers are applied. */
function build(schema: JsonSchema, w: Walk): string {
  if (schema.const !== undefined) return `z.literal(${lit(schema.const)})`;

  if (schema.enum) {
    const allStrings = schema.enum.every((v) => typeof v === 'string');
    return allStrings
      ? `z.enum([${schema.enum.map(lit).join(', ')}])`
      : `z.union([${schema.enum.map((v) => `z.literal(${lit(v)})`).join(', ')}])`;
  }

  if (schema.allOf?.length) {
    return schema.allOf
      .map((s, i) => convert(s, { ...w, path: `${w.path}/allOf/${i}` }))
      .reduce((a, b) => `z.intersection(${a}, ${b})`);
  }

  const unionKey = schema.oneOf ? 'oneOf' : 'anyOf';
  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    const members = union.map((s, i) => convert(s, { ...w, path: `${w.path}/${unionKey}/${i}` }));
    return members.length === 1 ? members[0]! : listExpr('z.union([', members, '])', w.indent);
  }

  switch (primaryType(schema)) {
    case 'string':
      return stringExpr(schema, w);
    case 'number':
    case 'integer':
      return numberExpr(schema);
    case 'boolean':
      return 'z.boolean()';
    case 'array':
      return arrayExpr(schema, w);
    case 'object':
      return objectExpr(schema, w);
    case 'null':
      return 'z.null()';
    default:
      return schema.properties ? objectExpr(schema, w) : 'z.any()';
  }
}

/** Resolve a `$ref` to a shared const, or inline it when there is no table. */
function refExpr(ref: string, w: Walk): string {
  const target = resolveRef(ref, w.ctx.components);
  if (!target) {
    note(w.ctx, {
      path: w.path,
      keyword: `$ref "${ref}"`,
      message: 'the target is not in the document',
    });
    return 'z.any()';
  }
  const name = refComponentName(ref);
  const shared = w.ctx.shared;
  if (shared) {
    return shared.declare(`ref:${ref}`, name, () =>
      convertNode(target, { ...w, path: `#/${name}`, indent: 0 }),
    );
  }
  // No table to hoist into: inline the target, and stop at a cycle.
  if (w.refStack.includes(ref)) {
    note(w.ctx, {
      path: w.path,
      keyword: `$ref "${ref}"`,
      message: 'the cycle cannot be inlined; nothing under it is validated',
    });
    return 'z.any()';
  }
  return convertNode(target, { ...w, path: `#/${name}`, refStack: [...w.refStack, ref] });
}

function stringExpr(schema: JsonSchema, w: Walk): string {
  let expr = 'z.string()';
  if (schema.format) {
    const method = STRING_FORMATS[schema.format];
    if (method) {
      expr += method;
    } else if (!IGNORED_STRING_FORMATS.has(schema.format)) {
      note(w.ctx, {
        path: w.path,
        keyword: `format "${schema.format}"`,
        message: 'the value is validated as a plain string',
      });
    }
  }
  if (typeof schema.minLength === 'number') expr += `.min(${schema.minLength})`;
  if (typeof schema.maxLength === 'number') expr += `.max(${schema.maxLength})`;
  if (schema.pattern) expr += `.regex(new RegExp(${lit(schema.pattern)}))`;
  return expr;
}

function numberExpr(schema: JsonSchema): string {
  let expr = 'z.number()';
  if (primaryType(schema) === 'integer') expr += '.int()';

  // Draft 2020-12 (OpenAPI 3.1) spells the exclusive bounds as numbers; OpenAPI
  // 3.0 spells them as booleans that modify `minimum`/`maximum`.
  const exclusiveMin =
    typeof schema.exclusiveMinimum === 'number'
      ? schema.exclusiveMinimum
      : schema.exclusiveMinimum === true
        ? schema.minimum
        : undefined;
  const exclusiveMax =
    typeof schema.exclusiveMaximum === 'number'
      ? schema.exclusiveMaximum
      : schema.exclusiveMaximum === true
        ? schema.maximum
        : undefined;

  if (typeof exclusiveMin === 'number') expr += `.gt(${exclusiveMin})`;
  else if (typeof schema.minimum === 'number') expr += `.min(${schema.minimum})`;
  if (typeof exclusiveMax === 'number') expr += `.lt(${exclusiveMax})`;
  else if (typeof schema.maximum === 'number') expr += `.max(${schema.maximum})`;
  if (typeof schema.multipleOf === 'number') expr += `.multipleOf(${schema.multipleOf})`;
  return expr;
}

function arrayExpr(schema: JsonSchema, w: Walk): string {
  const items = convert(schema.items, { ...w, path: `${w.path}/items` });
  let expr = `z.array(${items})`;
  if (typeof schema.minItems === 'number') expr += `.min(${schema.minItems})`;
  if (typeof schema.maxItems === 'number') expr += `.max(${schema.maxItems})`;
  if (schema.uniqueItems === true) {
    expr +=
      `.refine((v) => new Set(v.map((x) => JSON.stringify(x))).size === v.length,` +
      ` 'array items must be unique')`;
  }
  return expr;
}

function objectExpr(schema: JsonSchema, w: Walk): string {
  const props = Object.entries(schema.properties ?? {});
  const extra = schema.additionalProperties;

  // A "properties"-free object with a typed `additionalProperties` is a map.
  if (props.length === 0 && extra && typeof extra === 'object') {
    return `z.record(${convert(extra, { ...w, path: `${w.path}/additionalProperties` })})`;
  }

  const required = new Set(schema.required ?? []);
  const inner = w.indent + 2;
  const lines = props.map(([key, propSchema]) => {
    let expr = convert(propSchema, { ...w, path: `${w.path}/properties/${key}`, indent: inner });
    // `.default()` already makes a property optional on input *and* supplies the
    // value; appending `.optional()` on top would short-circuit the default.
    if (!required.has(key) && propSchema.default === undefined) expr += '.optional()';
    return `${' '.repeat(inner)}${propertyKey(key)}: ${expr},`;
  });

  let expr =
    lines.length > 0
      ? `z.object({\n${lines.join('\n')}\n${' '.repeat(w.indent)}})`
      : 'z.object({})';

  if (extra === false) expr += '.strict()';
  else if (extra === true) expr += '.passthrough()';
  else if (extra && typeof extra === 'object') {
    expr += `.catchall(${convert(extra, { ...w, path: `${w.path}/additionalProperties`, indent: w.indent })})`;
  }
  return expr;
}

/** Apply nullable/default modifiers shared across node types. */
function wrap(schema: JsonSchema, expr: string, allowNullable = true): string {
  let out = expr;
  if (allowNullable && isNullable(schema)) out += '.nullable()';
  if (schema.default !== undefined) out += `.default(${lit(schema.default)})`;
  return out;
}

/** `z.union([a, b])` on one line, or broken across lines when a member is. */
function listExpr(open: string, members: string[], close: string, indent: number): string {
  const oneLine = `${open}${members.join(', ')}${close}`;
  if (!oneLine.includes('\n') && oneLine.length + indent <= 100) return oneLine;
  const inner = ' '.repeat(indent + 2);
  return `${open}\n${members.map((m) => `${inner}${m},`).join('\n')}\n${' '.repeat(indent)}${close}`;
}

function note(ctx: SchemaContext, n: ConversionNote): void {
  const sink = ctx.shared?.noteSink ?? ctx.notes;
  sink?.push(n);
}

function reportUnsupported(schema: JsonSchema, w: Walk): void {
  const raw = schema as unknown as Record<string, unknown>;
  for (const [keyword, message] of Object.entries(UNSUPPORTED_KEYWORDS)) {
    if (raw[keyword] !== undefined) note(w.ctx, { path: w.path, keyword: `"${keyword}"`, message });
  }
}

function lit(value: unknown): string {
  return JSON.stringify(value);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Quote a property key only when it is not a plain identifier. */
function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function identifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return IDENTIFIER.test(cleaned) ? cleaned : `_${cleaned}`;
}

function refComponentName(ref: string): string {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return identifier(m?.[1] ?? ref);
}

function resolveRef(ref: string, components: Record<string, JsonSchema>): JsonSchema | undefined {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (!m) return undefined;
  return components[m[1]!];
}

function isNullable(schema: JsonSchema): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type)) return schema.type.includes('null');
  return false;
}

function primaryType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((t) => t !== 'null');
  return schema.type;
}

/** Shapes worth pulling into a shared const when they repeat. */
function hoistable(schema: JsonSchema): boolean {
  if (schema.$ref) return false;
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  if (primaryType(schema) === 'array' && schema.items) return true;
  if ((schema.oneOf ?? schema.anyOf ?? []).length >= 2) return true;
  if ((schema.allOf ?? []).length >= 1) return true;
  if ((schema.enum ?? []).length >= 2) return true;
  return false;
}

function* childSchemas(schema: JsonSchema): Generator<JsonSchema> {
  if (schema.items) yield schema.items;
  for (const p of Object.values(schema.properties ?? {})) yield p;
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    yield schema.additionalProperties;
  }
  for (const m of schema.oneOf ?? []) yield m;
  for (const m of schema.anyOf ?? []) yield m;
  for (const m of schema.allOf ?? []) yield m;
  for (const m of schema.prefixItems ?? []) yield m;
}

/**
 * A canonical string identifying a schema's *validation* shape: keys sorted so
 * declaration order cannot split a duplicate, annotations dropped so a differing
 * `description` cannot either.
 */
export function structuralKey(schema: JsonSchema): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => !ANNOTATION_KEYS.has(k) && v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
    }
    return value;
  };
  return JSON.stringify(canonical(schema));
}

/**
 * A stable name for an unnamed repeated structure. Derived from the structure
 * itself, never from a counter, so adding a schema does not renumber the others
 * and re-running the generator produces a byte-identical file.
 */
function structuralName(key: string): string {
  return `Shared${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}
