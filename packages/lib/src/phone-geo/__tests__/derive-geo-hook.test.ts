// packages/lib/src/phone-geo/__tests__/derive-geo-hook.test.ts

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../../field-hooks/types'
import type { CachedField } from '../../field-values/types'

// Mock the cache LEAF rather than the '../../cache' barrel, which drags in the Redis client.
vi.mock('../../cache/org-cache-helpers', () => ({ getCachedCustomFields: vi.fn() }))

// Mock the realtime LEAF, not the '../../realtime' barrel — the barrel has a known import-cycle
// gotcha with vi.mock (project memory). Same pattern as the address-normalize-hook test.
// Must resolve a promise, not `undefined` — the SUT attaches `.catch` to the returned value, and
// a bare `vi.fn()` would throw there and be swallowed, letting the happy-path tests pass without
// ever reaching the publish.
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(() => Promise.resolve()),
}))

// Plain synchronous factories (not `importOriginal`) — an async factory does not reliably apply
// to the SUT's own bindings here; see the note in address-normalize-hook.test.ts.
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithBuiltIn: vi.fn(),
  buildPublishEntry: (args: { fieldId: unknown; values: unknown[] }) => ({
    key: String(args.fieldId),
    value: args.values[0] ?? null,
  }),
}))
vi.mock('../../field-values/field-value-queries', () => ({ getValues: vi.fn() }))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: vi.fn(() => ({ organizationId: 'org1' })),
  getField: vi.fn(async () => ({ id: 'f', type: 'TEXT' })),
}))

import { getCachedCustomFields } from '../../cache/org-cache-helpers'
import { setValueWithBuiltIn } from '../../field-values/field-value-mutations'
import { getValues } from '../../field-values/field-value-queries'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { derivePhoneGeoOnChange } from '../derive-geo-hook'

const mockedFields = getCachedCustomFields as unknown as ReturnType<typeof vi.fn>
const mockedSetValue = setValueWithBuiltIn as unknown as ReturnType<typeof vi.fn>
const mockedGetValues = getValues as unknown as ReturnType<typeof vi.fn>
const mockedPublish = publishFieldValueUpdates as unknown as ReturnType<typeof vi.fn>

const CONTACT_DEF = 'contact'

/** The four geo fields as the contact definition carries them. */
const CONTACT_GEO_FIELDS = [
  { id: 'fld_city', systemAttribute: 'city' },
  { id: 'fld_region', systemAttribute: 'region' },
  { id: 'fld_country', systemAttribute: 'country' },
  { id: 'fld_timezone', systemAttribute: 'timezone' },
]

function buildEvent(phone: string | null): EntityFieldChangeEvent {
  return {
    recordId: toRecordId(CONTACT_DEF, 'inst1'),
    entityDefinitionId: CONTACT_DEF,
    entityType: 'contact',
    entitySlug: 'contacts',
    field: { id: 'fld_phone', type: 'PHONE_INTL' } as unknown as CachedField,
    oldValue: null,
    // Contact `phone` is multi-value, so a write arrives as an array ordered by sortKey.
    newValue: phone === null ? null : [{ type: 'text', value: phone }],
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org1',
    userId: 'user1',
  } as unknown as EntityFieldChangeEvent
}

/** What `setValueWithBuiltIn` was asked to write, as `{ fieldId: value }`. */
function writtenValues(): Record<string, unknown> {
  return Object.fromEntries(
    mockedSetValue.mock.calls.map(([, params]) => [params.fieldId, params.value])
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPublish.mockResolvedValue(undefined)
  mockedFields.mockResolvedValue(CONTACT_GEO_FIELDS)
  // Nothing filled in yet.
  mockedGetValues.mockResolvedValue(new Map())
  mockedSetValue.mockResolvedValue({ values: [{ id: 'v1', type: 'text', value: 'x' }] })
})

describe('derivePhoneGeoOnChange', () => {
  it('fills all four geo fields from the primary number', async () => {
    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    expect(writtenValues()).toEqual({
      fld_city: 'Los Angeles',
      fld_region: 'California',
      fld_country: 'United States',
      fld_timezone: 'America/Los_Angeles',
    })
  })

  it('writes quietly so the derivation never lands in the activity feed', async () => {
    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    // Plan 04 Phase B: the suppression is DECLARED on the session — a quiet
    // mode carrying its reason — rather than asserted by a bare
    // `publishEvents: false` beside a comment. Assert the declaration, and that
    // it actually carries a reason: an empty one would be the boolean again.
    expect(mockedSetValue.mock.calls.length).toBeGreaterThan(0)
    for (const [ctx, params] of mockedSetValue.mock.calls) {
      expect(ctx.session?.mode?.kind).toBe('quiet')
      expect(ctx.session?.mode?.reason ?? '').not.toHaveLength(0)
      // The bare boolean is gone, not merely redundant.
      expect(params).not.toHaveProperty('publishEvents')
    }
    // …but still pushes realtime itself, so an open drawer updates without a reload.
    expect(mockedPublish).toHaveBeenCalledTimes(1)
  })

  it('derives from the FIRST number when the field holds several', async () => {
    const event = buildEvent('+13102030000')
    event.newValue = [
      { type: 'text', value: '+13102030000' },
      { type: 'text', value: '+16172670000' },
    ] as unknown as EntityFieldChangeEvent['newValue']

    await derivePhoneGeoOnChange(event)

    expect(writtenValues().fld_city).toBe('Los Angeles')
  })

  it('never overwrites a field that already holds a value', async () => {
    // City came from the chat widget's visitor IP — a better signal than an area code.
    mockedGetValues.mockResolvedValue(
      new Map([['fld_city', { type: 'text', value: 'Denver' }]] as Array<[string, unknown]>)
    )

    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    const written = writtenValues()
    expect(written.fld_city).toBeUndefined()
    expect(written.fld_region).toBe('California')
  })

  it('treats a whitespace-only stored value as blank', async () => {
    mockedGetValues.mockResolvedValue(
      new Map([['fld_city', { type: 'text', value: '   ' }]] as Array<[string, unknown]>)
    )

    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    expect(writtenValues().fld_city).toBe('Los Angeles')
  })

  it('writes nothing when every target is already filled', async () => {
    mockedGetValues.mockResolvedValue(
      new Map(
        CONTACT_GEO_FIELDS.map((f) => [f.id, { type: 'text', value: 'set' }]) as Array<
          [string, unknown]
        >
      )
    )

    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    expect(mockedSetValue).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('omits timezone when the number’s prefix spans several zones', async () => {
    await derivePhoneGeoOnChange(buildEvent('+447400123456'))

    const written = writtenValues()
    expect(written.fld_country).toBe('United Kingdom')
    expect(written.fld_timezone).toBeUndefined()
  })

  it('no-ops on an entity that has no geo fields', async () => {
    // The hook is field-type-keyed, so it fires for PHONE_INTL on companies and custom entities
    // too — there is simply nothing to fill there.
    mockedFields.mockResolvedValue([{ id: 'fld_phone', systemAttribute: 'phone' }])

    await derivePhoneGeoOnChange(buildEvent('+13102030000'))

    expect(mockedSetValue).not.toHaveBeenCalled()
  })

  it.each([
    ['a cleared field', null],
    ['an unparseable number', 'not-a-number'],
  ])('no-ops for %s', async (_label, phone) => {
    await derivePhoneGeoOnChange(buildEvent(phone))

    expect(mockedFields).not.toHaveBeenCalled()
    expect(mockedSetValue).not.toHaveBeenCalled()
  })

  it('swallows a write failure rather than breaking the phone write', async () => {
    // Post-write hooks must never break the write that triggered them.
    mockedSetValue.mockRejectedValue(new Error('db down'))

    await expect(derivePhoneGeoOnChange(buildEvent('+13102030000'))).resolves.toBeUndefined()
  })
})
