// packages/lib/src/field-values/__tests__/address-struct-keys.test.ts

import type { FieldType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { jsonConverter } from '../converters/json'
import type { FieldValueContext } from '../field-value-helpers'
import { validateAndConvertValue } from '../field-value-helpers'
import { FieldValueValidator, fieldValueSchemas } from '../field-value-validator'

/**
 * `addressStructJson` is a CLOSED zod object, deliberately not `.passthrough()`: a key that is
 * not listed is dropped silently, before the value ever reaches storage or the post-write hook.
 * `name` and `residential`
 * (plans/apps/shipstation/shipstation-workflow-expansion-plan.md §4) are therefore only real
 * once they are in that schema — the failure mode this file guards is invisible at runtime.
 */

const ADDRESS_STRUCT = 'ADDRESS_STRUCT' as FieldType

const field = {
  id: 'field_address',
  type: ADDRESS_STRUCT,
  options: undefined,
} as unknown as Parameters<typeof validateAndConvertValue>[3]

const ctx = { validator: new FieldValueValidator() } as unknown as FieldValueContext

/** Full write path for a scalar JSON field: validate + convert, then read back out. */
async function roundTrip(value: unknown): Promise<Record<string, unknown> | null> {
  const typed = await validateAndConvertValue(ctx, value, ADDRESS_STRUCT, field)
  return jsonConverter.toRawValue(typed) as Record<string, unknown> | null
}

describe('addressStructJson carries name and residential', () => {
  it('round-trips a struct carrying both new keys', async () => {
    const struct = {
      street1: '123 Main St',
      street2: 'Apt 4',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
      name: 'Jane Smith',
      residential: 'yes',
    }

    await expect(roundTrip(struct)).resolves.toEqual(struct)
  })

  it('round-trips name and residential alongside the geocode enrichment keys', async () => {
    const struct = {
      street1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
      name: 'Acme Corp',
      residential: 'no',
      lat: 30.2672,
      lng: -97.7431,
      geocodedAt: '2026-09-11T00:00:00.000Z',
    }

    await expect(roundTrip(struct)).resolves.toEqual(struct)
  })

  it('accepts all three residential states and rejects anything else', () => {
    for (const residential of ['unknown', 'yes', 'no']) {
      const parsed = fieldValueSchemas.addressStructJson.safeParse({
        street1: '1 Foo St',
        residential,
      })
      expect(parsed.success).toBe(true)
      expect(parsed.success && parsed.data.residential).toBe(residential)
    }

    expect(
      fieldValueSchemas.addressStructJson.safeParse({ street1: '1 Foo St', residential: true })
        .success
    ).toBe(false)
    expect(
      fieldValueSchemas.addressStructJson.safeParse({
        street1: '1 Foo St',
        residential: 'RESIDENTIAL',
      }).success
    ).toBe(false)
  })

  it('a name alone satisfies the refine; a residential indicator alone does not', () => {
    expect(fieldValueSchemas.addressStructJson.safeParse({ name: 'Jane Smith' }).success).toBe(true)
    expect(fieldValueSchemas.addressStructJson.safeParse({ residential: 'yes' }).success).toBe(
      false
    )
  })

  it('is still closed — an unlisted key is dropped, not stored', async () => {
    const stored = await roundTrip({
      street1: '1 Foo St',
      company: 'Acme Corp',
      phone: '+15125551234',
    })
    expect(stored).toEqual({ street1: '1 Foo St' })
  })
})

describe('backward compatibility: structs written before the new keys existed', () => {
  const LEGACY_SHAPES: { label: string; struct: Record<string, unknown> }[] = [
    {
      label: 'the original six',
      struct: {
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
    },
    { label: 'street only', struct: { street1: '1 Foo St' } },
    { label: 'country only', struct: { country: 'DE' } },
    {
      label: 'with raw and a completed geocode',
      struct: {
        street1: 'Musterstraße 1',
        city: 'Berlin',
        zipCode: '12345',
        country: 'DE',
        raw: 'Musterstrasse 1 12345 Berlin',
        lat: 52.52,
        lng: 13.405,
        geocodedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ]

  it.each(LEGACY_SHAPES)('validates and round-trips unchanged — $label', async ({ struct }) => {
    expect(fieldValueSchemas.addressStructJson.safeParse(struct).success).toBe(true)
    await expect(roundTrip(struct)).resolves.toEqual(struct)
  })

  it('an empty struct is still rejected', () => {
    expect(fieldValueSchemas.addressStructJson.safeParse({}).success).toBe(false)
  })

  it('strips the transient _source marker path unchanged (still accepted)', () => {
    const parsed = fieldValueSchemas.addressStructJson.safeParse({
      street1: '1 Foo St',
      name: 'Jane Smith',
      _source: 'structured',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data._source).toBe('structured')
  })
})
