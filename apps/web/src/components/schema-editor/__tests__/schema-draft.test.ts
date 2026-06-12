// apps/web/src/components/schema-editor/__tests__/schema-draft.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import {
  draftToJsonSchema,
  jsonSchemaRootKind,
  jsonSchemaToDraft,
  type SchemaPolicy,
} from '../schema-draft'

const MCP: SchemaPolicy = { emitRequired: false }
const WORKFLOW: SchemaPolicy = { emitRequired: true }

/**
 * Recursively strip `x-auxx` and policy-dropped keywords so we can assert the
 * editor's "semantically identity" round-trip. `additionalProperties` is always
 * dropped (the OpenAI client re-adds it); `required` is dropped when comparing
 * an MCP-mode round-trip, which intentionally omits it.
 */
function normalize(value: unknown, opts: { keepRequired: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, opts))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'x-auxx' || k === 'additionalProperties') continue
      if (k === 'required' && !opts.keepRequired) continue
      out[k] = normalize(v, opts)
    }
    return out
  }
  return value
}

function roundTrip(schema: Record<string, unknown>, policy: SchemaPolicy) {
  return draftToJsonSchema(jsonSchemaToDraft(schema), policy)
}

describe('jsonSchemaToDraft — read mapping', () => {
  it('maps scalars, formats, and enums to FieldTypes', () => {
    const rows = jsonSchemaToDraft({
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        done: { type: 'boolean' },
        when: { type: 'string', format: 'date-time' },
        day: { type: 'string', format: 'date' },
        contact: { type: 'string', format: 'email' },
        site: { type: 'string', format: 'uri' },
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    })
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName.title.fieldType).toBe(FieldType.TEXT)
    expect(byName.count.fieldType).toBe(FieldType.NUMBER)
    expect(byName.done.fieldType).toBe(FieldType.CHECKBOX)
    expect(byName.when.fieldType).toBe(FieldType.DATETIME)
    expect(byName.day.fieldType).toBe(FieldType.DATE)
    expect(byName.contact.fieldType).toBe(FieldType.EMAIL)
    expect(byName.site.fieldType).toBe(FieldType.URL)
    expect(byName.status.fieldType).toBe(FieldType.SINGLE_SELECT)
    expect(byName.status.options?.map((o) => o.value)).toEqual(['open', 'closed'])
  })

  it('maps arrays to MULTI_SELECT / TAGS / object-array', () => {
    const rows = jsonSchemaToDraft({
      type: 'object',
      properties: {
        labels: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        tags: { type: 'array', items: { type: 'string' } },
        lines: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } } },
        },
      },
    })
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName.labels.fieldType).toBe(FieldType.MULTI_SELECT)
    expect(byName.tags.fieldType).toBe(FieldType.TAGS)
    expect(byName.lines.kind).toBe('array')
    expect(byName.lines.items?.kind).toBe('object')
  })

  it('reads nullable type unions', () => {
    const rows = jsonSchemaToDraft({
      type: 'object',
      properties: { note: { type: ['string', 'null'] } },
    })
    expect(rows[0].nullable).toBe(true)
    expect(rows[0].fieldType).toBe(FieldType.TEXT)
  })

  it('prefers x-auxx.fieldType over inference and keeps rich options', () => {
    const rows = jsonSchemaToDraft({
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open'],
          'x-auxx': {
            fieldType: 'SINGLE_SELECT',
            options: [{ id: 'o1', label: 'Open', value: 'open', color: 'green' }],
          },
        },
      },
    })
    expect(rows[0].fieldType).toBe(FieldType.SINGLE_SELECT)
    expect(rows[0].options).toEqual([{ id: 'o1', label: 'Open', value: 'open', color: 'green' }])
  })

  it('falls back to a JSON raw leaf for unrepresentable constructs', () => {
    const rows = jsonSchemaToDraft({
      type: 'object',
      properties: {
        either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        ref: { $ref: '#/$defs/Thing' },
        numbers: { type: 'number', enum: [1, 2, 3] },
        mixed: { type: ['string', 'number'] },
      },
    })
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    for (const name of ['either', 'ref', 'numbers', 'mixed']) {
      expect(byName[name].fieldType).toBe(FieldType.JSON)
      expect(byName[name].raw).toBeDefined()
    }
  })
})

describe('round-trip losslessness', () => {
  it('round-trips a SINGLE_SELECT through x-auxx (options survive)', () => {
    const draft = jsonSchemaToDraft({
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'closed'] } },
    })
    const out = draftToJsonSchema(draft, MCP) as {
      properties: { status: { 'x-auxx': { fieldType: string; options: unknown[] } } }
    }
    expect(out.properties.status['x-auxx'].fieldType).toBe('SINGLE_SELECT')
    expect(out.properties.status['x-auxx'].options).toHaveLength(2)
  })

  it('re-emits raw leaves verbatim', () => {
    const schema = {
      type: 'object',
      properties: {
        either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        ref: { $ref: '#/$defs/Thing' },
      },
    }
    expect(roundTrip(schema, MCP)).toEqual(schema)
  })

  it('headline invariant: a server schema round-trips to semantic identity (MCP mode)', () => {
    // Note: MCP mode drops `required` by policy and the editor never emits
    // `additionalProperties` — `normalize` accounts for both. The OpenAI client
    // re-adds `additionalProperties: false` where it actually matters.
    const server = {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string' },
        score: { type: 'number' },
        status: { type: 'string', enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' } },
        meta: {
          type: 'object',
          properties: { createdAt: { type: 'string', format: 'date-time' } },
        },
      },
    }
    const out = roundTrip(server, MCP)
    expect(normalize(out, { keepRequired: false })).toEqual(
      normalize(server, { keepRequired: false })
    )
  })

  it('workflow mode preserves the required array', () => {
    const server = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, nick: { type: 'string' } },
    }
    const out = roundTrip(server, WORKFLOW) as { required: string[] }
    expect(out.required).toEqual(['name'])
  })

  it('MCP mode never emits required even with required rows', () => {
    const draft = jsonSchemaToDraft({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    })
    expect(draftToJsonSchema(draft, MCP)).not.toHaveProperty('required')
  })
})

describe('non-object roots (MCP root: any)', () => {
  it('classifies root kinds', () => {
    expect(jsonSchemaRootKind({ type: 'object', properties: {} })).toBe('object')
    expect(
      jsonSchemaRootKind({ type: 'array', items: { type: 'object', properties: { id: {} } } })
    ).toBe('array-of-objects')
    expect(jsonSchemaRootKind({ type: 'array', items: { type: 'string' } })).toBe('other')
    expect(jsonSchemaRootKind({ type: 'string' })).toBe('other')
  })

  it('seeds rows from an array-of-objects root and re-wraps on save (no clobber)', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
      },
    }
    const rows = jsonSchemaToDraft(schema)
    expect(rows.map((r) => r.name)).toEqual(['id', 'name'])
    const out = draftToJsonSchema(rows, MCP, 'array-of-objects')
    expect(normalize(out, { keepRequired: false })).toEqual(schema)
  })

  it('yields zero rows for a non-representable root (handled as JSON-only)', () => {
    expect(jsonSchemaToDraft({ type: 'array', items: { type: 'string' } })).toEqual([])
    expect(jsonSchemaToDraft({ type: 'string' })).toEqual([])
  })
})

describe('legacy workflow node templates', () => {
  // The information-extractor "Order Details" template: nested array of objects,
  // number fields, formats, a required key. Re-emits without semantic loss.
  const orderTemplate = {
    type: 'object',
    properties: {
      orderNumber: { type: 'string', description: 'Order ID or number' },
      orderDate: { type: 'string', description: 'Order date', format: 'date' },
      customerEmail: { type: 'string', description: 'Customer email address', format: 'email' },
      items: {
        type: 'array',
        description: 'List of ordered items',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            quantity: { type: 'number', description: 'Quantity ordered' },
            price: { type: 'number', description: 'Unit price' },
          },
        },
      },
      subtotal: { type: 'number', description: 'Order subtotal before tax and shipping' },
    },
    required: ['orderNumber'],
  }

  it('round-trips the order template (workflow mode)', () => {
    const out = roundTrip(orderTemplate, WORKFLOW)
    expect(normalize(out, { keepRequired: true })).toEqual(
      normalize(orderTemplate, { keepRequired: true })
    )
  })

  it('preserves descriptions on nested object and array nodes', () => {
    const out = roundTrip(orderTemplate, WORKFLOW) as {
      properties: {
        items: {
          description: string
          items: { properties: Record<string, { description: string }> }
        }
      }
    }
    expect(out.properties.items.description).toBe('List of ordered items')
    expect(out.properties.items.items.properties.name.description).toBe('Product name')
  })
})
