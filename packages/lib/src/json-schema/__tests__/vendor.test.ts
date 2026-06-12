// packages/lib/src/json-schema/__tests__/vendor.test.ts

import { describe, expect, it } from 'vitest'
import { sanitizeFormatsForOpenAiStrict, stripVendorKeywords } from '../vendor'

describe('stripVendorKeywords', () => {
  it('removes x-auxx at every depth', () => {
    const schema = {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'closed'],
          'x-auxx': { fieldType: 'SINGLE_SELECT', options: [{ value: 'open', label: 'Open' }] },
        },
        nested: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string', 'x-auxx': { fieldType: 'TEXT' } },
              'x-auxx': { fieldType: 'TAGS' },
            },
          },
        },
      },
    }
    expect(stripVendorKeywords(schema)).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
        nested: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    })
  })

  it('does not mutate the input', () => {
    const schema = { type: 'string', 'x-auxx': { fieldType: 'TEXT' } }
    stripVendorKeywords(schema)
    expect(schema).toHaveProperty('x-auxx')
  })

  it('passes through schemas with no vendor keywords unchanged', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(stripVendorKeywords(schema)).toEqual(schema)
  })
})

describe('sanitizeFormatsForOpenAiStrict', () => {
  it('drops unsupported string formats (uri)', () => {
    const schema = {
      type: 'object',
      properties: {
        site: { type: 'string', format: 'uri' },
        email: { type: 'string', format: 'email' },
        when: { type: 'string', format: 'date-time' },
      },
    }
    expect(sanitizeFormatsForOpenAiStrict(schema)).toEqual({
      type: 'object',
      properties: {
        site: { type: 'string' },
        email: { type: 'string', format: 'email' },
        when: { type: 'string', format: 'date-time' },
      },
    })
  })

  it('keeps formats on nullable string unions', () => {
    const schema = { type: ['string', 'null'], format: 'email' }
    expect(sanitizeFormatsForOpenAiStrict(schema)).toEqual(schema)
  })

  it('drops unsupported formats inside array items', () => {
    const schema = {
      type: 'array',
      items: { type: 'string', format: 'uri' },
    }
    expect(sanitizeFormatsForOpenAiStrict(schema)).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })
})
