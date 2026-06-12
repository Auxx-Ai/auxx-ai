// packages/lib/src/agents/__tests__/scaffold-from-json-schema.test.ts

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { scaffoldFromSchema } from '../../evals/simulation/mock-tools'
import { scaffoldFromJsonSchema } from '../scaffold-from-json-schema'

describe('scaffoldFromJsonSchema', () => {
  it('returns undefined for an absent or empty schema (free-form mock)', () => {
    expect(scaffoldFromJsonSchema(undefined)).toBeUndefined()
    expect(scaffoldFromJsonSchema(null)).toBeUndefined()
    expect(scaffoldFromJsonSchema({})).toBeUndefined()
  })

  it('seeds primitives to their empty values', () => {
    expect(scaffoldFromJsonSchema({ type: 'string' })).toBe('')
    expect(scaffoldFromJsonSchema({ type: 'number' })).toBe(0)
    expect(scaffoldFromJsonSchema({ type: 'integer' })).toBe(0)
    expect(scaffoldFromJsonSchema({ type: 'boolean' })).toBe(false)
    expect(scaffoldFromJsonSchema({ type: 'null' })).toBeNull()
  })

  it('walks objects and arrays recursively', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, done: { type: 'boolean' } },
          },
        },
      },
    }
    expect(scaffoldFromJsonSchema(schema)).toEqual({
      title: '',
      count: 0,
      items: [{ id: '', done: false }],
    })
  })

  it('picks the first enum/const value and the first anyOf/oneOf variant', () => {
    expect(scaffoldFromJsonSchema({ enum: ['open', 'closed'] })).toBe('open')
    expect(scaffoldFromJsonSchema({ const: 'pinned' })).toBe('pinned')
    expect(scaffoldFromJsonSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('')
    expect(scaffoldFromJsonSchema({ oneOf: [{ type: 'boolean' }] })).toBe(false)
  })

  it('seeds the first concrete type of a nullable union and treats bare properties as object', () => {
    expect(scaffoldFromJsonSchema({ type: ['string', 'null'] })).toBe('')
    expect(scaffoldFromJsonSchema({ properties: { name: { type: 'string' } } })).toEqual({
      name: '',
    })
  })

  it('collapses unknown nodes to null instead of throwing', () => {
    expect(scaffoldFromJsonSchema({ type: 'object', properties: { weird: 12 } })).toEqual({
      weird: null,
    })
  })

  it('matches the Zod scaffold for a serialized native outputSchema', () => {
    // The builtin-installed-row pipeline: Zod outputSchema → z.toJSONSchema →
    // scaffoldFromJsonSchema must agree with the server's Zod-internals walker.
    const outputSchema = z.object({
      threads: z.array(
        z.object({
          id: z.string(),
          subject: z.string(),
          unread: z.boolean(),
          messageCount: z.number(),
        })
      ),
      total: z.number(),
      status: z.enum(['ok', 'partial']),
    })
    const jsonSchema = z.toJSONSchema(outputSchema, {
      unrepresentable: 'any',
    }) as Record<string, unknown>
    expect(scaffoldFromJsonSchema(jsonSchema)).toEqual(scaffoldFromSchema(outputSchema))
  })
})
