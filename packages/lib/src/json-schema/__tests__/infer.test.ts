// packages/lib/src/json-schema/__tests__/infer.test.ts

import { describe, expect, it } from 'vitest'
import { inferJsonSchema } from '../infer'

describe('inferJsonSchema — primitives', () => {
  it('infers scalar types directly (no object envelope)', () => {
    expect(inferJsonSchema('hello')).toEqual({ type: 'string' })
    expect(inferJsonSchema(42)).toEqual({ type: 'number' })
    expect(inferJsonSchema(3.14)).toEqual({ type: 'number' })
    expect(inferJsonSchema(true)).toEqual({ type: 'boolean' })
    expect(inferJsonSchema(null)).toEqual({ type: 'null' })
  })

  it('detects ISO date-time strings, not plain strings', () => {
    expect(inferJsonSchema('2026-06-11T12:00:00Z')).toEqual({
      type: 'string',
      format: 'date-time',
    })
    expect(inferJsonSchema('2026-06-11T12:00:00.123+02:00')).toEqual({
      type: 'string',
      format: 'date-time',
    })
  })

  it('detects date / time / email / uri string formats', () => {
    expect(inferJsonSchema('2026-06-19')).toEqual({ type: 'string', format: 'date' })
    expect(inferJsonSchema('13:45:00')).toEqual({ type: 'string', format: 'time' })
    expect(inferJsonSchema('13:45')).toEqual({ type: 'string', format: 'time' })
    expect(inferJsonSchema('a@b.com')).toEqual({ type: 'string', format: 'email' })
    expect(inferJsonSchema('https://x.com/y')).toEqual({ type: 'string', format: 'uri' })
    expect(inferJsonSchema('http://x.com')).toEqual({ type: 'string', format: 'uri' })
  })

  it('stays formatless for non-matching strings (conservative)', () => {
    expect(inferJsonSchema('hello')).toEqual({ type: 'string' })
    // No http(s) scheme and no `x@y.z` email shape → not tagged.
    expect(inferJsonSchema('foo:bar')).toEqual({ type: 'string' })
  })
})

describe('inferJsonSchema — objects', () => {
  it('infers properties recursively with no required / additionalProperties', () => {
    const schema = inferJsonSchema({ name: 'Ada', age: 36, active: true })
    expect(schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' },
      },
    })
    expect(schema).not.toHaveProperty('required')
    expect(schema).not.toHaveProperty('additionalProperties')
  })

  it('handles nesting', () => {
    expect(inferJsonSchema({ user: { id: 1, tags: ['a', 'b'] } })).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    })
  })

  it('infers an empty object', () => {
    expect(inferJsonSchema({})).toEqual({ type: 'object', properties: {} })
  })
})

describe('inferJsonSchema — arrays', () => {
  it('infers items from a homogeneous array', () => {
    expect(inferJsonSchema([1, 2, 3])).toEqual({
      type: 'array',
      items: { type: 'number' },
    })
  })

  it('infers empty-array items as unknown ({})', () => {
    expect(inferJsonSchema([])).toEqual({ type: 'array', items: {} })
  })

  it('unions properties across a sample of objects (each optional)', () => {
    const schema = inferJsonSchema([
      { id: 1, name: 'a' },
      { id: 2, label: 'b' },
    ])
    expect(schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          label: { type: 'string' },
        },
      },
    })
  })

  it('preserves a shared string format across an array of record objects', () => {
    const schema = inferJsonSchema([
      { email: 'a@b.com', when: '2026-06-19' },
      { email: 'c@d.com', when: '2026-06-20' },
    ]) as { items: { properties: Record<string, { type: string; format?: string }> } }
    expect(schema.items.properties.email).toEqual({ type: 'string', format: 'email' })
    expect(schema.items.properties.when).toEqual({ type: 'string', format: 'date' })
  })

  it('drops format when samples disagree on it', () => {
    // One email, one free-text → mixed string formats collapse to a bare type.
    const schema = inferJsonSchema([{ v: 'a@b.com' }, { v: 'hello' }]) as {
      items: { properties: Record<string, { type: string; format?: string }> }
    }
    expect(schema.items.properties.v).toEqual({ type: 'string' })
  })

  it('keeps a shared format nullable when null appears alongside', () => {
    const schema = inferJsonSchema([{ v: 'a@b.com' }, { v: null }]) as {
      items: { properties: Record<string, { type: string | string[]; format?: string }> }
    }
    expect(schema.items.properties.v).toEqual({ type: ['string', 'null'], format: 'email' })
  })

  it('collapses mixed scalar arrays to a type union', () => {
    const schema = inferJsonSchema(['a', 1]) as { type: string; items: { type: string[] } }
    expect(schema.type).toBe('array')
    expect(schema.items.type).toEqual(['string', 'number'])
  })

  it('only samples the first few elements', () => {
    const big = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }, { b: 'late' }]
    const schema = inferJsonSchema(big) as {
      items: { properties: Record<string, unknown> }
    }
    // The 6th element's `b` key is past the sample window.
    expect(schema.items.properties).toEqual({ a: { type: 'number' } })
  })
})

describe('inferJsonSchema — null unions', () => {
  it('emits a [type, null] union when an array mixes null with a concrete type', () => {
    const schema = inferJsonSchema(['x', null]) as { items: { type: string[] } }
    expect(schema.items.type).toEqual(['string', 'null'])
  })

  it('marks object items nullable when null appears alongside objects', () => {
    const schema = inferJsonSchema([{ a: 1 }, null]) as {
      items: { type: string[]; properties: Record<string, unknown> }
    }
    expect(schema.items.type).toEqual(['object', 'null'])
    expect(schema.items.properties).toEqual({ a: { type: 'number' } })
  })

  it('emits bare null when that is all that was seen', () => {
    expect(inferJsonSchema([null, null])).toEqual({ type: 'array', items: { type: 'null' } })
  })
})
