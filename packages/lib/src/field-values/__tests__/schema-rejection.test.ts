// packages/lib/src/field-values/__tests__/schema-rejection.test.ts

import { describe, expect, it } from 'vitest'
import { normalizeSettingValue } from '../../settings/normalize-setting-value'
import { fieldValueSchemas } from '../field-value-validator'

/**
 * Guards the `z.NEVER` failure mode that put `{"status":"aborted"}` into
 * production `FieldValue` rows.
 *
 * Under zod 4, `z.NEVER` is the `{status:'aborted'}` sentinel. Returning it
 * from a bare `.transform((v) => …)` — without reporting an issue — does NOT
 * fail the parse: `safeParse` comes back `success: true` with the sentinel
 * OBJECT as `data`. `validateSingleValue` validates by trusting
 * `result.success`, so the object flowed straight into storage. On `valueText`
 * (a text column) node-postgres serialized it and the literal string landed in
 * the DB; that is how two contacts ended up with a phone number of
 * `{"status":"aborted"}`.
 *
 * The correct form is `.transform((v, ctx) => { ctx.addIssue(…); return z.NEVER })`,
 * or a `.pipe()` that rejects the sentinel downstream (what saves `number`).
 */

/** Sentinel shape zod returns for `z.NEVER` — never a legitimate parse result here. */
function isAbortSentinel(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    'status' in value &&
    (value as { status: unknown }).status === 'aborted'
  )
}

/**
 * Inputs chosen to be invalid for every scalar schema. Object/array shapes are
 * excluded — the JSON schemas legitimately accept objects, and this sweep is
 * about scalar coercion.
 */
const BAD_INPUTS: unknown[] = ['banana', '', '   ', Number.NaN, {}, [], null, undefined]

describe('no fieldValueSchemas entry fails open with the abort sentinel', () => {
  // Iterating the registry (rather than listing types) is the point: a schema
  // added later with a bare `z.NEVER` transform fails here without anyone
  // remembering this rule.
  const entries = Object.entries(fieldValueSchemas)

  it('covers every exported schema', () => {
    expect(entries.length).toBeGreaterThan(5)
  })

  it.each(entries)('%s never returns sentinel data with success:true', (_name, schema) => {
    for (const input of BAD_INPUTS) {
      const result = schema.safeParse(input)
      if (result.success) {
        expect(isAbortSentinel(result.data)).toBe(false)
      }
    }
  })
})

describe('booleanSchema rejects instead of aborting', () => {
  it.each([['banana'], [{}], [[]], [Number.NaN]])('rejects %s', (input) => {
    expect(fieldValueSchemas.boolean.safeParse(input).success).toBe(false)
  })

  it('still coerces the accepted truthy/falsy spellings', () => {
    for (const [input, expected] of [
      [true, true],
      [false, false],
      ['true', true],
      ['false', false],
      ['1', true],
      ['0', false],
      [1, true],
      [0, false],
    ] as const) {
      const result = fieldValueSchemas.boolean.safeParse(input)
      expect(result.success && result.data).toBe(expected)
    }
  })
})

describe('dateSchema rejects instead of aborting', () => {
  it.each([['banana'], [{}], [Number.NaN]])('rejects %s', (input) => {
    expect(fieldValueSchemas.date.safeParse(input).success).toBe(false)
  })

  it('still accepts parseable dates', () => {
    expect(fieldValueSchemas.date.safeParse('2026-08-14').success).toBe(true)
    const asDate = fieldValueSchemas.date.safeParse(new Date('2026-08-14T00:00:00.000Z'))
    expect(asDate.success && asDate.data).toBe('2026-08-14T00:00:00.000Z')
  })
})

/**
 * The one path where the sentinel could be stored SILENTLY rather than blowing
 * up: settings persist to a `jsonb` column, so an object is perfectly
 * storable. On the `FieldValue` side CHECKBOX/DATE land in typed
 * `valueBoolean`/`valueDate` columns and Postgres rejects the sentinel outright.
 */
describe('normalizeSettingValue CHECKBOX no longer stores the sentinel', () => {
  const config = { fieldType: 'CHECKBOX' } as Parameters<typeof normalizeSettingValue>[1]

  it('throws on a non-boolean value', () => {
    expect(() => normalizeSettingValue('some.flag', config, 'banana' as never)).toThrow()
  })

  it('still accepts real booleans', () => {
    expect(normalizeSettingValue('some.flag', config, true as never)).toBe(true)
    expect(normalizeSettingValue('some.flag', config, false as never)).toBe(false)
  })
})
