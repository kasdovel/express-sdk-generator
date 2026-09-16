import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SharedSchemas,
  formatNote,
  structuralKey,
  toZod,
  type ConversionNote,
  type JsonSchema,
  type SchemaContext,
} from '../src/jsonSchemaToZod.js';

const ctx: SchemaContext = { components: {} };

/** Evaluate an emitted Zod expression, so a test can assert what it accepts. */
function evaluate(source: string): z.ZodTypeAny {
  return new Function('z', `return (${source});`)(z) as z.ZodTypeAny;
}

describe('toZod', () => {
  it('emits object with optional vs required props', () => {
    const src = toZod(
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      },
      ctx,
    );
    expect(src).toContain('a: z.string()');
    expect(src).toContain('b: z.number().optional()');
  });

  it('maps string formats and array', () => {
    expect(toZod({ type: 'string', format: 'email' }, ctx)).toBe('z.string().email()');
    expect(toZod({ type: 'array', items: { type: 'string' } }, ctx)).toBe('z.array(z.string())');
  });

  it('handles oneOf/anyOf unions and collapses a single member', () => {
    expect(toZod({ oneOf: [{ type: 'string' }, { type: 'number' }] }, ctx)).toBe(
      'z.union([z.string(), z.number()])',
    );
    // A one-member union is not wrapped in z.union.
    expect(toZod({ anyOf: [{ type: 'string' }] }, ctx)).toBe('z.string()');
  });

  it('handles enum, nullable, and $ref', () => {
    expect(toZod({ enum: ['a', 'b'] }, ctx)).toBe('z.enum(["a", "b"])');
    expect(toZod({ type: ['string', 'null'] }, ctx)).toBe('z.string().nullable()');

    const refCtx: SchemaContext = {
      components: {
        Foo: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      },
    };
    expect(toZod({ $ref: '#/components/schemas/Foo' }, refCtx)).toContain('x: z.string()');
  });

  it('does not stack .optional() on top of a .default()', () => {
    // `.default()` already makes the key optional on input. Appending
    // `.optional()` would swallow the default instead of applying it.
    const src = toZod(
      { type: 'object', properties: { limit: { type: 'integer', default: 10 } } },
      ctx,
    );
    expect(src).toContain('limit: z.number().int().default(10),');
    expect(evaluate(src).parse({})).toEqual({ limit: 10 });
  });
});

describe('toZod numeric keywords', () => {
  it('maps the draft 2020-12 numeric exclusive bounds and multipleOf', () => {
    const src = toZod(
      { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 },
      ctx,
    );
    expect(src).toBe('z.number().gt(0).lt(10).multipleOf(0.5)');
    const schema = evaluate(src);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(0.5).success).toBe(true);
    expect(schema.safeParse(0.7).success).toBe(false);
    expect(schema.safeParse(10).success).toBe(false);
  });

  it('maps the OpenAPI 3.0 boolean exclusive bounds onto minimum/maximum', () => {
    const src = toZod(
      { type: 'integer', minimum: 1, exclusiveMinimum: true, maximum: 5, exclusiveMaximum: true },
      ctx,
    );
    expect(src).toBe('z.number().int().gt(1).lt(5)');
    const schema = evaluate(src);
    expect(schema.safeParse(1).success).toBe(false);
    expect(schema.safeParse(2).success).toBe(true);
  });

  it('keeps inclusive bounds when no exclusive keyword is present', () => {
    expect(toZod({ type: 'integer', minimum: 1, maximum: 5 }, ctx)).toBe(
      'z.number().int().min(1).max(5)',
    );
  });
});

describe('toZod array keywords', () => {
  it('maps minItems/maxItems', () => {
    const src = toZod({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 }, ctx);
    expect(src).toBe('z.array(z.string()).min(1).max(2)');
    const schema = evaluate(src);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(['a']).success).toBe(true);
    expect(schema.safeParse(['a', 'b', 'c']).success).toBe(false);
  });

  it('enforces uniqueItems with a refinement', () => {
    const src = toZod({ type: 'array', items: { type: 'number' }, uniqueItems: true }, ctx);
    const schema = evaluate(src);
    expect(schema.safeParse([1, 2, 3]).success).toBe(true);
    expect(schema.safeParse([1, 1]).success).toBe(false);
  });
});

describe('toZod additionalProperties', () => {
  it('maps false to .strict() and true to .passthrough()', () => {
    const props = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    const strict = evaluate(toZod({ ...props, additionalProperties: false } as JsonSchema, ctx));
    expect(strict.safeParse({ a: 'x', b: 1 }).success).toBe(false);

    const open = evaluate(toZod({ ...props, additionalProperties: true } as JsonSchema, ctx));
    expect(open.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
  });

  it('maps a typed additionalProperties to .catchall(), or z.record() with no properties', () => {
    const withProps = toZod(
      {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: { type: 'number' },
      },
      ctx,
    );
    expect(withProps).toContain('.catchall(z.number())');
    expect(evaluate(withProps).safeParse({ a: 'x', b: 'not a number' }).success).toBe(false);

    const map = toZod({ type: 'object', additionalProperties: { type: 'number' } }, ctx);
    expect(map).toBe('z.record(z.number())');
  });

  it('leaves an unspecified additionalProperties at Zod defaults', () => {
    const src = toZod(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      ctx,
    );
    expect(src).not.toContain('.strict()');
    expect(src).not.toContain('.passthrough()');
    expect(evaluate(src).parse({ a: 'x', b: 1 })).toEqual({ a: 'x' });
  });
});

describe('toZod unsupported keywords', () => {
  it('reports each keyword it cannot represent instead of dropping it silently', () => {
    const notes: ConversionNote[] = [];
    toZod(
      {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' }, contains: { const: 'x' } },
          meta: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
        },
        minProperties: 1,
      } as JsonSchema,
      { ...ctx, notes },
    );
    const keywords = notes.map((n) => n.keyword);
    expect(keywords).toContain('"minProperties"');
    expect(keywords).toContain('"contains"');
    expect(keywords).toContain('"patternProperties"');
    expect(notes.find((n) => n.keyword === '"contains"')?.path).toBe('#/properties/tags');
  });

  it('reports a string format it cannot express, but not an encoding format', () => {
    const notes: ConversionNote[] = [];
    toZod({ type: 'string', format: 'hostname' }, { ...ctx, notes });
    expect(notes).toHaveLength(1);
    expect(formatNote(notes[0]!)).toBe(
      '// sdkgen: unsupported format "hostname" at # — the value is validated as a plain string',
    );

    const ignored: ConversionNote[] = [];
    toZod({ type: 'string', format: 'binary' }, { ...ctx, notes: ignored });
    expect(ignored).toEqual([]);
  });

  it('reports a dangling $ref', () => {
    const notes: ConversionNote[] = [];
    expect(toZod({ $ref: '#/components/schemas/Nope' }, { ...ctx, notes })).toBe('z.any()');
    expect(notes[0]?.keyword).toContain('$ref');
  });
});

describe('SharedSchemas', () => {
  const components: Record<string, JsonSchema> = {
    User: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
    },
  };

  it('names a $ref after its component instead of inlining it', () => {
    const shared = new SharedSchemas(components);
    shared.plan([{ $ref: '#/components/schemas/User' }]);
    const expr = toZod({ $ref: '#/components/schemas/User' }, { components, shared });

    expect(expr).toBe('User');
    expect(shared.declarations().join('\n')).toContain('export const User = z.object({');
    expect(shared.componentNames()).toEqual(['User']);
  });

  it('reuses the component const for an inline copy of the same shape', () => {
    const shared = new SharedSchemas(components);
    const inline = components.User!;
    shared.plan([{ $ref: '#/components/schemas/User' }, inline]);

    expect(toZod({ $ref: '#/components/schemas/User' }, { components, shared })).toBe('User');
    expect(toZod(inline, { components, shared })).toBe('User');
    expect(shared.declarations()).toHaveLength(1);
  });

  it('dedupes a repeated inline shape into one shared const', () => {
    const shape: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    };
    const shared = new SharedSchemas({});
    shared.plan([shape, shape, { type: 'string' }]);

    const first = toZod(shape, { components: {}, shared });
    const second = toZod(shape, { components: {}, shared });
    expect(first).toBe(second);
    expect(first).toMatch(/^Shared[0-9a-f]{8}$/);
    expect(shared.declarations()).toHaveLength(1);
    // Hash-derived names are an implementation detail, not exported as types.
    expect(shared.componentNames()).toEqual([]);
  });

  it('leaves a shape that occurs once inline', () => {
    const shape: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    };
    const shared = new SharedSchemas({});
    shared.plan([shape]);
    expect(toZod(shape, { components: {}, shared })).toContain('z.object({');
    expect(shared.declarations()).toEqual([]);
  });

  it('derives shared names from the shape, so they are stable across runs', () => {
    const shape: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    };
    const other: JsonSchema = {
      type: 'object',
      properties: { b: { type: 'number' } },
      required: ['b'],
    };
    const name = (roots: JsonSchema[]): string => {
      const shared = new SharedSchemas({});
      shared.plan(roots);
      return toZod(shape, { components: {}, shared });
    };

    // Adding another shared schema ahead of it must not renumber this one.
    expect(name([shape, shape])).toBe(name([other, other, shape, shape]));
  });

  it('ignores annotation-only differences when matching structures', () => {
    expect(structuralKey({ type: 'string', description: 'a' })).toBe(
      structuralKey({ type: 'string', description: 'b' }),
    );
    // Key order is not part of a schema's identity either.
    expect(structuralKey({ type: 'string', minLength: 1 })).toBe(
      structuralKey({ minLength: 1, type: 'string' }),
    );
    // A `default` is validation behaviour, so it *does* change the identity.
    expect(structuralKey({ type: 'string' })).not.toBe(
      structuralKey({ type: 'string', default: 'x' }),
    );
  });

  it('never takes a name the generated file has reserved', () => {
    const shared = new SharedSchemas(components, ['User']);
    shared.plan([{ $ref: '#/components/schemas/User' }]);
    expect(toZod({ $ref: '#/components/schemas/User' }, { components, shared })).toBe('User_2');
  });
});

describe('recursive schemas', () => {
  const components: Record<string, JsonSchema> = {
    Category: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
      },
      required: ['name'],
    },
  };

  it('round-trips a $ref cycle through z.lazy() instead of z.any()', () => {
    const shared = new SharedSchemas(components);
    shared.plan([{ $ref: '#/components/schemas/Category' }]);
    expect(toZod({ $ref: '#/components/schemas/Category' }, { components, shared })).toBe(
      'Category',
    );

    const source = shared.declarations().join('\n');
    expect(source).toContain('z.lazy(() =>');
    expect(source).toContain('sdkgen: recursive schema');
    expect(source).not.toContain('z.any()');

    // The emitted declaration really validates, nested levels included.
    const expr = /z\.lazy\(\(\) => ([\s\S]+)\);$/.exec(source)?.[1];
    const Category: z.ZodTypeAny = z.lazy(() =>
      new Function('z', 'Category', `return (${expr});`)(z, Category),
    );
    expect(Category.safeParse({ name: 'a', children: [{ name: 'b' }] }).success).toBe(true);
    expect(Category.safeParse({ name: 'a', children: [{ nope: 1 }] }).success).toBe(false);
  });

  it('marks every declaration on a mutual cycle as lazy', () => {
    const mutual: Record<string, JsonSchema> = {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } }, required: ['b'] },
      B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } }, required: ['a'] },
    };
    const shared = new SharedSchemas(mutual);
    shared.plan([{ $ref: '#/components/schemas/A' }]);
    toZod({ $ref: '#/components/schemas/A' }, { components: mutual, shared });

    const decls = shared.declarations();
    expect(decls).toHaveLength(2);
    // Both must be lazy: whichever is declared first references the other
    // before it exists, which would be a TDZ error if it were evaluated eagerly.
    expect(decls.every((d) => d.includes('z.lazy(() =>'))).toBe(true);
  });

  it('reports the loss when there is no table to hoist into', () => {
    const notes: ConversionNote[] = [];
    const expr = toZod({ $ref: '#/components/schemas/Category' }, { components, notes });
    expect(expr).toContain('z.any()');
    expect(notes.map((n) => n.message)).toContain(
      'the cycle cannot be inlined; nothing under it is validated',
    );
  });
});

describe('emitted formatting', () => {
  it('indents nested objects consistently and quotes only non-identifier keys', () => {
    const src = toZod(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nested: {
            type: 'object',
            properties: { deep: { type: 'object', properties: { x: { type: 'string' } } } },
          },
          'x-odd': { type: 'string' },
        },
        required: ['id'],
      },
      ctx,
    );

    expect(src).toBe(
      [
        'z.object({',
        '  id: z.string(),',
        '  nested: z.object({',
        '    deep: z.object({',
        '      x: z.string().optional(),',
        '    }).optional(),',
        '  }).optional(),',
        '  "x-odd": z.string().optional(),',
        '})',
      ].join('\n'),
    );
  });

  it("honours the caller's starting indent so a nested emission stays aligned", () => {
    const src = toZod({ type: 'object', properties: { a: { type: 'string' } } }, ctx, {
      indent: 4,
    });
    expect(src).toBe(['z.object({', '      a: z.string().optional(),', '    })'].join('\n'));
  });
});
