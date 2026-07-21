// packages/lib/src/geocoding/__tests__/geocoder.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { geocode, geocodeStructured, setGeocodeFetcherForTesting } from '../geocoder'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe('geocodeStructured', () => {
  const originalKey = process.env.MAPTILER_API_KEY

  beforeEach(() => {
    process.env.MAPTILER_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.MAPTILER_API_KEY = originalKey
    setGeocodeFetcherForTesting(undefined)
  })

  it('returns null when MAPTILER_API_KEY is absent', async () => {
    process.env.MAPTILER_API_KEY = ''
    setGeocodeFetcherForTesting(async () => jsonResponse({ features: [] }))
    expect(await geocodeStructured('123 Main St')).toBeNull()
  })

  it('returns null for empty input', async () => {
    setGeocodeFetcherForTesting(async () => jsonResponse({ features: [] }))
    expect(await geocodeStructured('   ')).toBeNull()
  })

  it('returns null when the response has no features', async () => {
    setGeocodeFetcherForTesting(async () => jsonResponse({ features: [] }))
    expect(await geocodeStructured('123 Main St, Austin, TX')).toBeNull()
  })

  it('parses center, place_name, relevance, and context[] by id prefix', async () => {
    setGeocodeFetcherForTesting(async () =>
      jsonResponse({
        features: [
          {
            center: [-97.7431, 30.2672],
            place_name: '123 Main St, Austin, TX 78701, United States',
            text: 'Main St',
            address: '123',
            relevance: 0.95,
            context: [
              { id: 'postal_code.123', text: '78701' },
              { id: 'place.456', text: 'Austin' },
              { id: 'region.789', text: 'Texas', short_code: 'US-TX' },
              { id: 'country.US', text: 'United States', short_code: 'us' },
            ],
          },
        ],
      })
    )

    const result = await geocodeStructured('123 Main St, Austin, TX 78701')
    expect(result).toEqual({
      lat: 30.2672,
      lng: -97.7431,
      placeName: '123 Main St, Austin, TX 78701, United States',
      relevance: 0.95,
      components: {
        street1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
    })
  })

  it('uppercases a lowercase country short_code to ISO alpha-2', async () => {
    setGeocodeFetcherForTesting(async () =>
      jsonResponse({
        features: [
          {
            center: [13.405, 52.52],
            place_name: 'Musterstraße 1, 12345 Berlin, Germany',
            text: 'Musterstraße',
            relevance: 1,
            context: [{ id: 'country.DE', text: 'Germany', short_code: 'de' }],
          },
        ],
      })
    )

    const result = await geocodeStructured('Musterstraße 1, 12345 Berlin')
    expect(result?.components.country).toBe('DE')
  })

  it('falls back to the region context text when no short_code is present', async () => {
    setGeocodeFetcherForTesting(async () =>
      jsonResponse({
        features: [
          {
            center: [1, 2],
            relevance: 1,
            context: [{ id: 'region.1', text: 'Some Province' }],
          },
        ],
      })
    )

    const result = await geocodeStructured('somewhere')
    expect(result?.components.state).toBe('Some Province')
  })

  it('defaults relevance to 1 when the response omits it', async () => {
    setGeocodeFetcherForTesting(async () => jsonResponse({ features: [{ center: [1, 2] }] }))
    const result = await geocodeStructured('somewhere')
    expect(result?.relevance).toBe(1)
  })

  it('returns null on a non-ok response', async () => {
    setGeocodeFetcherForTesting(async () => ({ ok: false, json: async () => ({}) }) as Response)
    expect(await geocodeStructured('123 Main St')).toBeNull()
  })

  it('returns null and never throws when the fetcher rejects', async () => {
    setGeocodeFetcherForTesting(async () => {
      throw new Error('network down')
    })
    await expect(geocodeStructured('123 Main St')).resolves.toBeNull()
  })
})

describe('geocode (delegates to geocodeStructured)', () => {
  const originalKey = process.env.MAPTILER_API_KEY

  beforeEach(() => {
    process.env.MAPTILER_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.MAPTILER_API_KEY = originalKey
    setGeocodeFetcherForTesting(undefined)
  })

  it('returns just { lat, lng } for existing call sites', async () => {
    setGeocodeFetcherForTesting(async () =>
      jsonResponse({
        features: [
          {
            center: [-97.7431, 30.2672],
            relevance: 0.9,
            context: [{ id: 'place.1', text: 'Austin' }],
          },
        ],
      })
    )
    const result = await geocode('123 Main St, Austin, TX')
    expect(result).toEqual({ lat: 30.2672, lng: -97.7431 })
  })

  it('returns null when geocodeStructured returns null', async () => {
    setGeocodeFetcherForTesting(async () => jsonResponse({ features: [] }))
    expect(await geocode('123 Main St')).toBeNull()
  })
})
