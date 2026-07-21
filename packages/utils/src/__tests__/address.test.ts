// packages/utils/src/__tests__/address.test.ts

import { describe, expect, it } from 'vitest'
import {
  type AddressStructValue,
  formatAddress,
  formatAddressForGeocode,
  parseAddress,
} from '../address'

/** Normalizes optional/undefined fields so struct comparisons don't trip on `undefined` vs `''`. */
function norm(a: Partial<AddressStructValue>) {
  return {
    street1: a.street1 ?? '',
    street2: a.street2 ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    zipCode: a.zipCode ?? '',
    country: a.country ?? '',
  }
}

describe('formatAddress', () => {
  it('renders the canonical one-liner (decision #10)', () => {
    expect(
      formatAddress({
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      })
    ).toBe('123 Main St, Apt 4, Austin, TX 78701, United States')
  })

  it('omits the country when it matches domesticCountry (alpha-2, case-insensitive)', () => {
    const a = {
      street1: '123 Main St',
      street2: 'Apt 4',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    }
    expect(formatAddress(a, { domesticCountry: 'us' })).toBe('123 Main St, Apt 4, Austin, TX 78701')
    expect(formatAddress(a, { domesticCountry: 'GB' })).toBe(
      '123 Main St, Apt 4, Austin, TX 78701, United States'
    )
  })

  it('always appends the country name when no domesticCountry is given', () => {
    expect(
      formatAddress({ street1: '1 Foo St', city: 'Bar', state: 'X', zipCode: '1', country: 'DE' })
    ).toContain('Germany')
  })

  it('DE profile orders zip before city with no state (decision #10)', () => {
    expect(
      formatAddress(
        { street1: 'Musterstraße 1', city: 'Berlin', state: '', zipCode: '12345', country: 'DE' },
        { domesticCountry: 'DE' }
      )
    ).toBe('Musterstraße 1, 12345 Berlin')
  })

  it('DE profile includes a comma-joined unit', () => {
    expect(
      formatAddress(
        {
          street1: 'Musterstraße 1',
          street2: 'Whg 4',
          city: 'Berlin',
          state: '',
          zipCode: '12345',
          country: 'DE',
        },
        { domesticCountry: 'DE' }
      )
    ).toBe('Musterstraße 1, Whg 4, 12345 Berlin')
  })

  it('opts.country overrides domestic-omission: code / omit / name', () => {
    const a = {
      street1: '10 Downing Street',
      city: 'London',
      state: '',
      zipCode: 'SW1A 2AA',
      country: 'GB',
    }
    expect(formatAddress(a, { domesticCountry: 'GB', country: 'code' })).toBe(
      '10 Downing Street, London, SW1A 2AA, GB'
    )
    expect(formatAddress(a, { country: 'omit' })).toBe('10 Downing Street, London, SW1A 2AA')
    expect(formatAddress(a, { domesticCountry: 'GB', country: 'name' })).toBe(
      '10 Downing Street, London, SW1A 2AA, United Kingdom'
    )
  })

  it('returns empty string when every part is empty (caller can || null)', () => {
    expect(formatAddress({})).toBe('')
    expect(formatAddress({ street1: '', city: '', state: '', zipCode: '', country: '' })).toBe('')
  })
})

describe('formatAddressForGeocode', () => {
  it('flat comma-joins all parts including the raw country code, skipping empties', () => {
    expect(
      formatAddressForGeocode({
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      })
    ).toBe('123 Main St, Apt 4, Austin, TX, 78701, US')
  })

  it('is not a display formatter — no DE reordering, no country-name resolution', () => {
    expect(
      formatAddressForGeocode({
        street1: 'Musterstraße 1',
        city: 'Berlin',
        state: '',
        zipCode: '12345',
        country: 'DE',
      })
    ).toBe('Musterstraße 1, Berlin, 12345, DE')
  })

  it('skips empty components', () => {
    expect(formatAddressForGeocode({ street1: '123 Main St', city: 'Austin', country: 'US' })).toBe(
      '123 Main St, Austin, US'
    )
  })
})

describe('parseAddress — US fixtures', () => {
  it('parses a typed one-liner with a unit and country name', () => {
    const [top] = parseAddress('123 Main St, Apt 4, Austin, TX 78701, USA', {
      defaultCountry: 'US',
    })
    expect(norm(top!.struct)).toEqual({
      street1: '123 Main St',
      street2: 'Apt 4',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    })
    expect(top!.countrySource).toBe('token')
    expect(top!.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('parses a pasted multiline address (no unit)', () => {
    const [top] = parseAddress('123 Main St\nAustin, TX 78701', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '123 Main St',
      street2: '',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    })
  })

  it('parses comma-less input at lower confidence', () => {
    const [top] = parseAddress('123 Main St Austin TX 78701', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '123 Main St',
      street2: '',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    })
    expect(top!.confidence).toBeLessThan(0.8)
  })

  it('detects a unit line via the unit-keyword regex', () => {
    const [top] = parseAddress('123 Main St, Suite 200, Austin, TX 78701', {
      defaultCountry: 'US',
    })
    expect(top!.struct.street1).toBe('123 Main St')
    expect(top!.struct.street2).toBe('Suite 200')
  })

  it('produces two candidates when the second segment is not clearly a unit', () => {
    const candidates = parseAddress('123 Main St, Building 2, Austin, TX 78701', {
      defaultCountry: 'US',
    })
    expect(candidates.length).toBe(2)
    expect(candidates[0]!.confidence).toBeGreaterThanOrEqual(candidates[1]!.confidence)
  })
})

describe('parseAddress — DE fixtures', () => {
  it('parses a typed one-liner (zip before city, no state)', () => {
    const [top] = parseAddress('Musterstraße 1, 12345 Berlin, Germany', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: 'Musterstraße 1',
      street2: '',
      city: 'Berlin',
      state: '',
      zipCode: '12345',
      country: 'DE',
    })
    expect(top!.countrySource).toBe('token')
  })

  it('parses a pasted multiline address with a unit', () => {
    const [top] = parseAddress('Musterstraße 1\nWhg 4\n12345 Berlin, Germany', {
      defaultCountry: 'US',
    })
    expect(norm(top!.struct)).toEqual({
      street1: 'Musterstraße 1',
      street2: 'Whg 4',
      city: 'Berlin',
      state: '',
      zipCode: '12345',
      country: 'DE',
    })
  })

  it('parses comma-less input', () => {
    const [top] = parseAddress('Musterstraße 1 12345 Berlin', { defaultCountry: 'DE' })
    expect(norm(top!.struct)).toEqual({
      street1: 'Musterstraße 1',
      street2: '',
      city: 'Berlin',
      state: '',
      zipCode: '12345',
      country: 'DE',
    })
  })
})

describe('parseAddress — CA fixtures', () => {
  it('parses a typed one-liner (unambiguous postal shape)', () => {
    const [top] = parseAddress('123 Main St, Toronto, ON M5V 3A8', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '123 Main St',
      street2: '',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5V 3A8',
      country: 'CA',
    })
    expect(top!.countrySource).toBe('postal-shape')
  })
})

describe('parseAddress — UK fixtures', () => {
  it('parses a typed one-liner (unambiguous postal shape, no state)', () => {
    const [top] = parseAddress('10 Downing Street, London, SW1A 2AA', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '10 Downing Street',
      street2: '',
      city: 'London',
      state: '',
      zipCode: 'SW1A 2AA',
      country: 'GB',
    })
    expect(top!.countrySource).toBe('postal-shape')
  })

  it('parses a city+postcode combined into one trailing segment', () => {
    const [top] = parseAddress('10 Downing Street, London SW1A 2AA', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '10 Downing Street',
      street2: '',
      city: 'London',
      state: '',
      zipCode: 'SW1A 2AA',
      country: 'GB',
    })
  })

  it('parses comma-less input', () => {
    const [top] = parseAddress('10 Downing Street London SW1A 2AA', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '10 Downing Street',
      street2: '',
      city: 'London',
      state: '',
      zipCode: 'SW1A 2AA',
      country: 'GB',
    })
  })
})

describe('parseAddress — US/DE 5-digit zip collision', () => {
  it('resolves via street-line shape (number-first) even against a conflicting defaultCountry', () => {
    const [top] = parseAddress('123 Main St, Austin, 78701', { defaultCountry: 'DE' })
    expect(top!.struct.country).toBe('US')
    expect(top!.countrySource).toBe('postal-shape')
  })

  it('resolves via street-line shape (number-last) even against a conflicting defaultCountry', () => {
    const [top] = parseAddress('Musterstraße 1, 12345 Berlin', { defaultCountry: 'US' })
    expect(top!.struct.country).toBe('DE')
    expect(top!.countrySource).toBe('postal-shape')
  })

  it('falls back to defaultCountry when the street shape is inconclusive', () => {
    const [top] = parseAddress('Main Plaza, Somewhere, 12345', { defaultCountry: 'DE' })
    expect(top!.struct.country).toBe('DE')
    expect(top!.countrySource).toBe('default')
  })

  it('falls back to defaultCountry (US) when the street shape is inconclusive', () => {
    const [top] = parseAddress('Main Plaza, Somewhere, 12345', { defaultCountry: 'US' })
    expect(top!.struct.country).toBe('US')
    expect(top!.countrySource).toBe('default')
  })
})

describe('parseAddress — no anchors at all', () => {
  it('falls back to defaultCountry with low confidence', () => {
    const [top] = parseAddress('123 Main St, Springfield', { defaultCountry: 'US' })
    expect(top!.struct.country).toBe('US')
    expect(top!.countrySource).toBe('default')
    expect(top!.confidence).toBeLessThan(0.8)
  })

  it('returns no candidates for empty input', () => {
    expect(parseAddress('', { defaultCountry: 'US' })).toEqual([])
    expect(parseAddress('   ', { defaultCountry: 'US' })).toEqual([])
  })
})

describe('round-trip property: parseAddress(formatAddress(x)) reproduces x', () => {
  const fixtures: { label: string; struct: AddressStructValue; domesticCountry: string }[] = [
    {
      label: 'US',
      struct: {
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
      domesticCountry: 'US',
    },
    {
      label: 'US (no unit)',
      struct: {
        street1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
      domesticCountry: 'US',
    },
    {
      label: 'CA',
      struct: {
        street1: '123 Main St',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5V 3A8',
        country: 'CA',
      },
      domesticCountry: 'CA',
    },
    {
      label: 'UK',
      struct: {
        street1: '10 Downing Street',
        city: 'London',
        state: '',
        zipCode: 'SW1A 2AA',
        country: 'GB',
      },
      domesticCountry: 'GB',
    },
    {
      label: 'DE',
      struct: {
        street1: 'Musterstraße 1',
        street2: 'Whg 4',
        city: 'Berlin',
        state: '',
        zipCode: '12345',
        country: 'DE',
      },
      domesticCountry: 'DE',
    },
    {
      label: 'DE (no unit)',
      struct: {
        street1: 'Musterstraße 1',
        city: 'Berlin',
        state: '',
        zipCode: '12345',
        country: 'DE',
      },
      domesticCountry: 'DE',
    },
  ]

  it.each(fixtures)('reproduces the $label fixture from its own formatted output', ({
    struct,
    domesticCountry,
  }) => {
    const formatted = formatAddress(struct, { domesticCountry })
    const [top] = parseAddress(formatted, { defaultCountry: domesticCountry })
    expect(norm(top!.struct)).toEqual(norm(struct))
  })
})

describe('parseAddress full state/province names', () => {
  it('normalizes a full state name in a comma-separated segment', () => {
    const [top] = parseAddress('123 Main St, Austin, Texas 78701', { defaultCountry: 'US' })
    expect(norm(top!.struct)).toEqual({
      street1: '123 Main St',
      street2: '',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    })
  })

  it('matches a multi-word full name in the locality remainder', () => {
    const [top] = parseAddress('55 Water St, Brooklyn New York 11201', { defaultCountry: 'US' })
    expect(top!.struct.state).toBe('NY')
    expect(top!.struct.city).toBe('Brooklyn')
    expect(top!.struct.zipCode).toBe('11201')
  })

  it('matches a full province name in comma-less Canadian input', () => {
    const [top] = parseAddress('1 Queen St Toronto Ontario M5H 2M9 Canada', {
      defaultCountry: 'US',
    })
    expect(norm(top!.struct)).toEqual({
      street1: '1 Queen St',
      street2: '',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
      country: 'CA',
    })
  })

  it('does not consume a city that IS a state name when nothing precedes it', () => {
    const [top] = parseAddress('55 Water St, New York 10041', { defaultCountry: 'US' })
    expect(top!.struct.city).toBe('New York')
    expect(top!.struct.state).toBe('')
  })
})

describe('parseAddress city capitalization', () => {
  it('capitalizes lowercase city names, including multi-word and hyphenated', () => {
    expect(
      parseAddress('123 main st, austin, tx 78701', { defaultCountry: 'US' })[0]!.struct.city
    ).toBe('Austin')
    expect(
      parseAddress('55 water st, new york, ny 10041', { defaultCountry: 'US' })[0]!.struct.city
    ).toBe('New York')
    expect(
      parseAddress('1 trade st, winston-salem, nc 27101', { defaultCountry: 'US' })[0]!.struct.city
    ).toBe('Winston-Salem')
  })

  it('never lowercases deliberately-cased input', () => {
    expect(
      parseAddress('100 Main St, McAllen, TX 78501', { defaultCountry: 'US' })[0]!.struct.city
    ).toBe('McAllen')
    expect(
      parseAddress('123 Main St, AUSTIN, TX 78701', { defaultCountry: 'US' })[0]!.struct.city
    ).toBe('AUSTIN')
  })

  it('capitalizes the city in DE-profile parses', () => {
    expect(
      parseAddress('Musterstraße 1, 10115 berlin', { defaultCountry: 'DE' })[0]!.struct.city
    ).toBe('Berlin')
  })
})
