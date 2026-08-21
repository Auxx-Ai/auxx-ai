// packages/lib/src/field-values/ai-autofill/__tests__/type-specs.test.ts
//
// The AI-eligible type roster lives in exactly two places — the plain name Set
// in `@auxx/types/custom-field` (which `@auxx/services` gates saves on and
// cannot import from lib) and the per-type contract table in lib. This file is
// the joint: an exact-set-equality test that makes them one atomic change,
// plus per-type schema-shape assertions so a spec cannot quietly emit a shape
// `validateSingleValue` would reject.

import type { CustomFieldEntity } from '@auxx/database/types'
import { AI_ELIGIBLE_FIELD_TYPES } from '@auxx/types/custom-field'
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../errors'
import { buildJsonSchema } from '../json-schema-builder'
import { AI_TYPE_SPECS } from '../type-specs'

function field(overrides: Partial<CustomFieldEntity>): CustomFieldEntity {
  return {
    id: 'fld_1',
    name: 'Test field',
    type: 'TEXT',
    options: {},
    ...overrides,
  } as CustomFieldEntity
}

/** The `value` sub-schema out of the `{ value: T }` envelope. */
function valueSchema(f: CustomFieldEntity): Record<string, unknown> {
  const built = buildJsonSchema(f) as {
    schema: { properties: { value: Record<string, unknown> } }
  }
  return built.schema.properties.value
}

const OPTIONS = [
  { id: 'opt_a', value: 'opt_a', label: 'Alpha' },
  { id: 'opt_b', value: 'opt_b', label: 'Beta' },
]

describe('AI_TYPE_SPECS ↔ AI_ELIGIBLE_FIELD_TYPES', () => {
  it('is an exact set equality — neither list may grow alone', () => {
    const specTypes = new Set(Object.keys(AI_TYPE_SPECS))
    const eligibleTypes = new Set(AI_ELIGIBLE_FIELD_TYPES)

    const missingSpec = [...eligibleTypes].filter((t) => !specTypes.has(t))
    const missingEligible = [...specTypes].filter((t) => !eligibleTypes.has(t))

    expect(missingSpec).toEqual([])
    expect(missingEligible).toEqual([])
  })

  it('gives every spec a schema and a shape hint', () => {
    for (const [type, spec] of Object.entries(AI_TYPE_SPECS)) {
      const f = field({ type: type as CustomFieldEntity['type'], options: { options: OPTIONS } })
      expect(typeof spec?.schema(f), type).toBe('object')
      expect(spec?.shapeHint(f).length, type).toBeGreaterThan(0)
    }
  })

  it('produces a strict envelope with `value` required for every eligible type', () => {
    for (const type of Object.keys(AI_TYPE_SPECS)) {
      const built = buildJsonSchema(
        field({ type: type as CustomFieldEntity['type'], options: { options: OPTIONS } })
      )
      expect(built, type).toMatchObject({
        name: 'ai_autofill_result',
        strict: true,
        schema: { type: 'object', additionalProperties: false, required: ['value'] },
      })
    }
  })
})

describe('nullable types', () => {
  it.each([
    'URL',
    'EMAIL',
    'PHONE_INTL',
    'NAME',
    'ADDRESS_STRUCT',
  ] as const)('%s admits null so the model can decline instead of fabricating', (type) => {
    expect(AI_TYPE_SPECS[type]?.nullable).toBe(true)
    expect(valueSchema(field({ type })).type).toContain('null')
  })

  it.each([
    'TEXT',
    'NUMBER',
    'CHECKBOX',
    'DATE',
    'CURRENCY',
  ] as const)('%s stays non-nullable', (type) => {
    expect(valueSchema(field({ type })).type).not.toContain('null')
  })
})

describe('per-type schema shapes', () => {
  it('CURRENCY is integer, never number — minor units are integral by definition', () => {
    expect(valueSchema(field({ type: 'CURRENCY' }))).toEqual({ type: 'integer' })
  })

  it('CURRENCY names the resolved denomination and its exponent in the hint', () => {
    const usd = AI_TYPE_SPECS.CURRENCY?.shapeHint(field({ type: 'CURRENCY' }), {
      orgCurrencyCode: 'USD',
    })
    expect(usd).toContain('USD')
    expect(usd).toContain('1999')

    // Field code wins over the org code (field → org → USD).
    const jpy = AI_TYPE_SPECS.CURRENCY?.shapeHint(
      field({ type: 'CURRENCY', options: { currencyCode: 'JPY' } }),
      { orgCurrencyCode: 'USD' }
    )
    expect(jpy).toContain('JPY')
    expect(jpy).toContain('no minor unit')
  })

  it('DATETIME asks for a full timestamp, DATE for a calendar date', () => {
    expect(valueSchema(field({ type: 'DATE' }))).toEqual({ type: 'string', format: 'date' })
    expect(valueSchema(field({ type: 'DATETIME' }))).toEqual({
      type: 'string',
      format: 'date-time',
    })
  })

  it('TIME constrains to bare HH:MM — the form its normalizer can anchor', () => {
    const schema = valueSchema(field({ type: 'TIME' }))
    expect(schema.type).toBe('string')
    const pattern = new RegExp(schema.pattern as string)
    expect(pattern.test('14:30')).toBe(true)
    expect(pattern.test('00:00')).toBe(true)
    expect(pattern.test('24:00')).toBe(false)
    // Seconds are excluded on purpose: `parseTimeOfDay` only accepts HH:MM.
    expect(pattern.test('14:30:00')).toBe(false)
  })

  it('NAME and ADDRESS_STRUCT put every member in `required` as a nullable string', () => {
    const name = valueSchema(field({ type: 'NAME' }))
    expect(name.required).toEqual(['firstName', 'lastName'])
    const nameProps = name.properties as Record<string, { type: unknown }>
    expect(nameProps.firstName?.type).toEqual(['string', 'null'])
    expect(nameProps.lastName?.type).toEqual(['string', 'null'])

    const address = valueSchema(field({ type: 'ADDRESS_STRUCT' }))
    expect(address.required).toEqual(['street1', 'street2', 'city', 'state', 'zipCode', 'country'])
    expect(address.additionalProperties).toBe(false)
  })

  it('select types enumerate their option ids', () => {
    expect(valueSchema(field({ type: 'SINGLE_SELECT', options: { options: OPTIONS } }))).toEqual({
      type: 'string',
      enum: ['opt_a', 'opt_b'],
    })
    expect(valueSchema(field({ type: 'MULTI_SELECT', options: { options: OPTIONS } }))).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['opt_a', 'opt_b'] },
    })
  })
})

describe('TAGS — constrained vs open', () => {
  it('is byte-for-byte MULTI_SELECT when allowNewOptions is off', () => {
    const tags = valueSchema(field({ type: 'TAGS', options: { options: OPTIONS } }))
    const multiSelect = valueSchema(field({ type: 'MULTI_SELECT', options: { options: OPTIONS } }))
    expect(tags).toEqual(multiSelect)
  })

  it('drops the enum and names existing labels in the prompt when open', () => {
    const open = field({
      type: 'TAGS',
      options: { options: OPTIONS, ai: { enabled: true, allowNewOptions: true } },
    })
    expect(valueSchema(open)).toEqual({ type: 'array', items: { type: 'string' } })

    const hint = AI_TYPE_SPECS.TAGS?.shapeHint(open)
    expect(hint).toContain('Alpha')
    expect(hint).toContain('Beta')
  })

  it('rejects a constrained TAGS field with no options, but allows an open one', () => {
    expect(() => buildJsonSchema(field({ type: 'TAGS', options: { options: [] } }))).toThrow(
      BadRequestError
    )
    expect(() =>
      buildJsonSchema(
        field({
          type: 'TAGS',
          options: { options: [], ai: { enabled: true, allowNewOptions: true } },
        })
      )
    ).not.toThrow()
  })
})

describe('normalizers', () => {
  it('anchors a bare TIME onto a date the date validator can parse', () => {
    const normalized = AI_TYPE_SPECS.TIME?.normalize?.('14:30', field({ type: 'TIME' }), {
      organizationId: 'org_1',
    }) as string

    expect(Number.isNaN(new Date(normalized).getTime())).toBe(false)
    // Mirrors the human picker: local clock time, seconds and ms zeroed.
    const anchored = new Date(normalized)
    expect(anchored.getHours()).toBe(14)
    expect(anchored.getMinutes()).toBe(30)
    expect(anchored.getSeconds()).toBe(0)
    expect(anchored.getMilliseconds()).toBe(0)
  })

  it('clears rather than throws when the model returns an unusable TIME', () => {
    expect(
      AI_TYPE_SPECS.TIME?.normalize?.('half past two', field({ type: 'TIME' }), {
        organizationId: 'org_1',
      })
    ).toBeNull()
  })

  it.each([
    ['NAME', { firstName: 'Jane', lastName: null }, { firstName: 'Jane' }],
    ['NAME', { firstName: null, lastName: null }, null],
    [
      'ADDRESS_STRUCT',
      {
        street1: '1 Main St',
        street2: null,
        city: 'Berlin',
        state: null,
        zipCode: '',
        country: 'DE',
      },
      { street1: '1 Main St', city: 'Berlin', country: 'DE' },
    ],
  ] as const)('%s drops null members strict mode forced into `required`', (type, input, want) => {
    expect(
      AI_TYPE_SPECS[type]?.normalize?.(input, field({ type }), { organizationId: 'org_1' })
    ).toEqual(want)
  })

  it('leaves types whose output already satisfies validateSingleValue alone', () => {
    for (const type of ['TEXT', 'RICH_TEXT', 'NUMBER', 'CURRENCY', 'CHECKBOX', 'DATE'] as const) {
      expect(AI_TYPE_SPECS[type]?.normalize, type).toBeUndefined()
    }
    // PHONE_INTL included: `validateSingleValue` already runs the shared E.164
    // normalization, so a second coercion pass here could only disagree with it.
    expect(AI_TYPE_SPECS.PHONE_INTL?.normalize).toBeUndefined()
  })
})
