// packages/lib/src/geocoding/__tests__/address-normalize-hook.test.ts

import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../../field-hooks/types'
import type { CachedField } from '../../field-values/types'

// Mock the geocoder leaf module directly so the merge matrix is deterministic —
// no real MapTiler call / env key required.
vi.mock('../geocoder', () => ({ geocodeStructured: vi.fn() }))

// Mock the realtime LEAF module, not the '../../realtime' barrel — the barrel has a known
// import-cycle gotcha with vi.mock (project memory); mocking the file the barrel re-exports
// from is enough, matching the pattern in
// field-values/__tests__/batched-realtime-publish.test.ts.
vi.mock('../../realtime/publish-helpers', () => ({ publishFieldValueUpdates: vi.fn() }))

// Stub the DB-backed `setValueWithBuiltIn` so the write-back is observable without a real
// database, and hand-roll a minimal `buildPublishEntry` (same shaping the real one does — array
// for array-return field types, first-value-or-null otherwise) instead of pulling in the real
// module via `importOriginal`: an async `importOriginal` factory here does not reliably apply to
// this SUT's own binding (verified empirically — its `setValueWithBuiltIn` import kept resolving
// to the REAL implementation, which then hit real cache/DB code paths and threw), while a plain
// synchronous factory (as used for '../geocoder' above) does.
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithBuiltIn: vi.fn(),
  buildPublishEntry: (args: {
    publishRecordId: unknown
    fieldId: unknown
    field: { type?: string; options?: unknown } | undefined
    values: unknown[]
  }) => ({
    key: `${String(args.publishRecordId)}:${String(args.fieldId)}`,
    value: args.values.length > 0 ? args.values[0] : null,
  }),
}))

// Stub the stale-write guard's re-read (`getValue`) — per-test default is set inside
// `buildEvent`: the store still holds exactly what this event wrote.
vi.mock('../../field-values/field-value-queries', () => ({ getValue: vi.fn() }))

import { setValueWithBuiltIn } from '../../field-values/field-value-mutations'
import { getValue } from '../../field-values/field-value-queries'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import { normalizeAddressOnChange } from '../address-normalize-hook'
import { geocodeStructured } from '../geocoder'

const mockedGeocode = geocodeStructured as unknown as ReturnType<typeof vi.fn>
const mockedSetValue = setValueWithBuiltIn as unknown as ReturnType<typeof vi.fn>
const mockedGetValue = getValue as unknown as ReturnType<typeof vi.fn>
const mockedPublish = publishFieldValueUpdates as unknown as ReturnType<typeof vi.fn>

const recordId: RecordId = toRecordId('contact', 'inst-1')

function fieldFixture(): CachedField {
  return {
    id: 'field-address',
    type: 'ADDRESS_STRUCT',
    entityDefinitionId: null,
  } as unknown as CachedField
}

function jsonValue(value: Record<string, unknown> | null): any {
  if (value === null) return null
  return { id: 'fv-1', type: 'json', value }
}

function buildEvent(overrides: Partial<EntityFieldChangeEvent> = {}): EntityFieldChangeEvent {
  const event: EntityFieldChangeEvent = {
    recordId,
    entityDefinitionId: 'def-1',
    entityType: 'contact',
    entitySlug: 'contacts',
    field: fieldFixture(),
    oldValue: null,
    newValue: null,
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org-1',
    userId: 'user-1',
    ...overrides,
  }
  // Stale-write-guard default: the stored value is still exactly what this event wrote.
  // Individual tests override this to simulate a concurrent edit landing mid-geocode.
  mockedGetValue.mockResolvedValue(event.newValue)
  return event
}

/** The handler's geocode + write-back run fire-and-forget; give the background promise chain a
 * real macrotask turn (not just microtasks — the real `field-value-mutations` module this suite
 * imports via `importOriginal` pulls in real infra client construction at import time) to settle
 * before asserting. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

function writtenValue(callIndex = 0): Record<string, unknown> {
  return mockedSetValue.mock.calls[callIndex]![1].value
}

describe('normalizeAddressOnChange', () => {
  beforeEach(() => {
    mockedGeocode.mockReset()
    mockedSetValue.mockReset()
    mockedPublish.mockReset()
    mockedGetValue.mockReset()
    mockedPublish.mockResolvedValue(undefined)
    mockedSetValue.mockResolvedValue({
      state: 'complete',
      performedAt: '2026-01-01T00:00:00.000Z',
      values: [jsonValue({ street1: '123 Main St' })],
    })
  })

  it('bails on an empty struct without calling the geocoder', async () => {
    await normalizeAddressOnChange(buildEvent({ newValue: jsonValue({ street1: '' }) }))
    await flush()
    expect(mockedGeocode).not.toHaveBeenCalled()
    expect(mockedSetValue).not.toHaveBeenCalled()
  })

  it('bails when newValue is null', async () => {
    await normalizeAddressOnChange(buildEvent({ newValue: null }))
    await flush()
    expect(mockedGeocode).not.toHaveBeenCalled()
  })

  it('does nothing when the geocoder returns null and there is no _source to strip', async () => {
    mockedGeocode.mockResolvedValue(null)
    await normalizeAddressOnChange(
      buildEvent({ newValue: jsonValue({ street1: '123 Main St', city: 'Austin' }) })
    )
    await flush()
    expect(mockedSetValue).not.toHaveBeenCalled()
  })

  it('strips a lingering _source even when the geocoder returns null (cheapest correct write)', async () => {
    mockedGeocode.mockResolvedValue(null)
    await normalizeAddressOnChange(
      buildEvent({
        newValue: jsonValue({ street1: '123 Main St', city: 'Austin', _source: 'single' }),
      })
    )
    await flush()
    expect(mockedSetValue).toHaveBeenCalledTimes(1)
    const written = writtenValue()
    expect(written._source).toBeUndefined()
    expect(written.lat).toBeUndefined()
    expect(written.city).toBe('Austin')
  })

  describe('_source: single', () => {
    it('merges canonical city/state/zip/country + lat/lng and clears raw at relevance >= 0.8', async () => {
      mockedGeocode.mockResolvedValue({
        lat: 30.1,
        lng: -97.1,
        placeName: 'x',
        relevance: 0.9,
        components: { city: 'Austin', state: 'TX', zipCode: '78701', country: 'US' },
      })
      await normalizeAddressOnChange(
        buildEvent({
          newValue: jsonValue({
            street1: '123 Main St',
            city: 'Awstin',
            state: '',
            zipCode: '',
            country: '',
            raw: '123 main st austin tx',
            _source: 'single',
          }),
        })
      )
      await flush()
      const written = writtenValue()
      expect(written).toMatchObject({
        street1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
        lat: 30.1,
        lng: -97.1,
      })
      expect(written.raw).toBeUndefined()
      expect(written._source).toBeUndefined()
      expect(typeof written.geocodedAt).toBe('string')
    })

    it('below relevance 0.8: adds only lat/lng/geocodedAt, keeps raw + original components', async () => {
      mockedGeocode.mockResolvedValue({
        lat: 30.1,
        lng: -97.1,
        placeName: 'x',
        relevance: 0.4,
        components: { city: 'Austin', state: 'TX', zipCode: '78701', country: 'US' },
      })
      await normalizeAddressOnChange(
        buildEvent({
          newValue: jsonValue({
            street1: '123 Main St',
            city: 'Somewhere Else',
            raw: 'garbled input',
            _source: 'single',
          }),
        })
      )
      await flush()
      const written = writtenValue()
      expect(written.city).toBe('Somewhere Else')
      expect(written.raw).toBe('garbled input')
      expect(written.lat).toBe(30.1)
      expect(written.lng).toBe(-97.1)
      expect(written._source).toBeUndefined()
    })
  })

  it('_source: structured merges lat/lng/geocodedAt only — never touches components', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: { city: 'Wrong City', state: 'ZZ', zipCode: '00000', country: 'XX' },
    })
    await normalizeAddressOnChange(
      buildEvent({
        newValue: jsonValue({
          street1: '123 Main St',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          country: 'US',
          _source: 'structured',
        }),
      })
    )
    await flush()
    const written = writtenValue()
    expect(written).toMatchObject({ city: 'Austin', state: 'TX', zipCode: '78701', country: 'US' })
    expect(written.lat).toBe(1)
    expect(written.lng).toBe(2)
    expect(written._source).toBeUndefined()
  })

  it('no _source marker: fills only BLANK locality components, never street1/street2', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: {
        street1: 'Ignored Street',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
    })
    await normalizeAddressOnChange(
      buildEvent({
        newValue: jsonValue({
          street1: '',
          street2: '',
          city: '',
          state: 'NY', // already set — must NOT be overwritten
          zipCode: '',
          country: '',
        }),
      })
    )
    await flush()
    const written = writtenValue()
    expect(written.street1).toBe('') // geocoder owns locality, never the street line
    expect(written.street2).toBe('')
    expect(written.city).toBe('Austin')
    expect(written.state).toBe('NY')
    expect(written.zipCode).toBe('78701')
    expect(written.country).toBe('US')
  })

  it('idempotence guard: no-op when components are unchanged and geo is already stamped', async () => {
    const stamped = {
      street1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
      lat: 30.1,
      lng: -97.1,
      geocodedAt: '2026-01-01T00:00:00.000Z',
    }
    await normalizeAddressOnChange(
      buildEvent({ oldValue: jsonValue(stamped), newValue: jsonValue({ ...stamped }) })
    )
    await flush()
    expect(mockedGeocode).not.toHaveBeenCalled()
    expect(mockedSetValue).not.toHaveBeenCalled()
  })

  it('idempotence guard does not suppress a genuine component edit', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 40,
      lng: -70,
      placeName: 'x',
      relevance: 1,
      components: {},
    })
    const oldStruct = {
      street1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
      lat: 30.1,
      lng: -97.1,
      geocodedAt: '2026-01-01T00:00:00.000Z',
    }
    const newStruct = { ...oldStruct, city: 'Dallas' }
    await normalizeAddressOnChange(
      buildEvent({ oldValue: jsonValue(oldStruct), newValue: jsonValue(newStruct) })
    )
    await flush()
    expect(mockedGeocode).toHaveBeenCalledTimes(1)
  })

  it('stale-write guard: skips the write-back when the field changed while geocoding', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: {},
    })
    const event = buildEvent({
      newValue: jsonValue({ street1: '123 Main St', city: 'Austin', _source: 'single' }),
    })
    // A concurrent edit landed while the geocode was in flight — the stored components no
    // longer match what this normalize run started from.
    mockedGetValue.mockResolvedValue(jsonValue({ street1: '456 Oak Ave', city: 'Dallas' }))
    await normalizeAddressOnChange(event)
    await flush()
    expect(mockedSetValue).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('writes back quietly via setValueWithBuiltIn with publishEvents: false', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: {},
    })
    await normalizeAddressOnChange(
      buildEvent({ newValue: jsonValue({ street1: '123 Main St', _source: 'structured' }) })
    )
    await flush()
    expect(mockedSetValue).toHaveBeenCalledTimes(1)
    expect(mockedSetValue.mock.calls[0]![1]).toMatchObject({
      recordId,
      fieldId: 'field-address',
      publishEvents: false,
    })
  })

  it('publishes the full composed value via realtime after a successful write-back', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: {},
    })
    await normalizeAddressOnChange(
      buildEvent({ newValue: jsonValue({ street1: '123 Main St', _source: 'structured' }) })
    )
    await flush()
    expect(mockedPublish).toHaveBeenCalledTimes(1)
    const [, organizationId, entries] = mockedPublish.mock.calls[0]!
    expect(organizationId).toBe('org-1')
    expect(entries).toHaveLength(1)
    expect(entries[0].value).not.toBeNull()
  })

  it('does not publish realtime when the quiet write produced no values', async () => {
    mockedGeocode.mockResolvedValue({
      lat: 1,
      lng: 2,
      placeName: 'x',
      relevance: 1,
      components: {},
    })
    mockedSetValue.mockResolvedValue({
      state: 'complete',
      performedAt: '2026-01-01T00:00:00.000Z',
      values: [],
    })
    await normalizeAddressOnChange(
      buildEvent({ newValue: jsonValue({ street1: '123 Main St', _source: 'structured' }) })
    )
    await flush()
    expect(mockedPublish).not.toHaveBeenCalled()
  })
})
