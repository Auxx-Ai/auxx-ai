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
    // A bare date is not date-time — no format guessing beyond date-time.
    expect(inferJsonSchema('2026-06-11')).toEqual({ type: 'string' })
    expect(inferJsonSchema('not a date')).toEqual({ type: 'string' })
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
