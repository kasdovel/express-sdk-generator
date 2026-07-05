import { describe, it, expect } from 'vitest';
import { toZod, type SchemaContext } from '../src/jsonSchemaToZod.js';

const ctx: SchemaContext = { components: {} };

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
    expect(src).toContain('"a": z.string()');
    expect(src).toContain('"b": z.number().optional()');
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
    expect(toZod({ $ref: '#/components/schemas/Foo' }, refCtx)).toContain('"x": z.string()');
  });
});
