// packages/lib/src/phone-geo/__tests__/lookup.test.ts

import { describe, expect, it } from 'vitest'
import { lookupPhoneGeo, warmPhoneGeo } from '../lookup'

// NOTE: never use `555` prefixes here. They are fictional, carry no NPA-NXX entry, and silently
// fall back to state level — a test built on them would pass while asserting nothing about the
// city path, and would make a genuinely broken lookup look correct.

describe('lookupPhoneGeo', () => {
  it('resolves city + region from an NPA-NXX prefix', () => {
    expect(lookupPhoneGeo('+13102030000')).toMatchObject({
      city: 'Los Angeles',
      region: 'California',
      country: 'United States',
      timezone: 'America/Los_Angeles',
    })
  })

  it('expands the state abbreviation to a full name', () => {
    // Google publishes `Boston, MA`; we store the expanded form so phone-derived values match
    // what the IP-geo writer produces.
    expect(lookupPhoneGeo('+16172670000')).toMatchObject({
      city: 'Boston',
      region: 'Massachusetts',
    })
  })

  it('falls back to region alone when the area code has no city data', () => {
    const result = lookupPhoneGeo('+19497520000')
    expect(result).toMatchObject({ region: 'California', country: 'United States' })
    expect(result?.city).toBeUndefined()
  })

  it('normalizes Google’s "Washington State" to the plain state name', () => {
    expect(lookupPhoneGeo('+12064560000')?.region).toBe('Washington')
  })

  it('resolves Canadian provinces', () => {
    expect(lookupPhoneGeo('+14165550100')).toMatchObject({
      region: 'Ontario',
      country: 'Canada',
      timezone: 'America/Toronto',
    })
  })

  it('resolves non-NANP numbers', () => {
    expect(lookupPhoneGeo('+493012345678')).toMatchObject({
      region: 'Berlin',
      country: 'Germany',
      timezone: 'Europe/Berlin',
    })
  })

  it('omits timezone when the prefix spans more than one zone', () => {
    // A UK mobile maps to Europe/London, Europe/Guernsey and Europe/Isle_of_Man. Picking the
    // first would be a coin flip presented as a fact.
    const result = lookupPhoneGeo('+447400123456')
    expect(result?.country).toBe('United Kingdom')
    expect(result?.timezone).toBeUndefined()
  })

  it('never returns a raw "City, ST" string in either field', () => {
    const result = lookupPhoneGeo('+13124430000')
    expect(result?.city).toBe('Chicago')
    expect(result?.region).toBe('Illinois')
  })

  it('parses a national number when given an explicit region', () => {
    expect(lookupPhoneGeo('(310) 203-0000', 'US')?.city).toBe('Los Angeles')
  })

  it('refuses to guess a region for national input', () => {
    // Assuming one fails silently: `030 901820` parsed as US would yield a plausible answer for a
    // number the caller never meant, and this function's whole job is to say where a number is
    // from. Returning null is the only honest answer.
    expect(lookupPhoneGeo('(310) 203-0000')).toBeNull()
    expect(lookupPhoneGeo('030 901820')).toBeNull()
  })

  it('parses the same national input differently per region', () => {
    // The point of requiring a region: identical digits, different countries.
    expect(lookupPhoneGeo('030 901820', 'DE')).toMatchObject({ country: 'Germany' })
  })

  it('needs no region for E.164, which is self-describing', () => {
    expect(lookupPhoneGeo('+493012345678')?.country).toBe('Germany')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not a number', 'hello'],
    ['impossible number', '+1999'],
  ])('returns null for %s', (_label, input) => {
    expect(lookupPhoneGeo(input)).toBeNull()
  })

  it('warms without throwing and stays consistent afterwards', () => {
    expect(() => warmPhoneGeo()).not.toThrow()
    expect(lookupPhoneGeo('+13102030000')?.city).toBe('Los Angeles')
  })

  it('is fast enough to run inline on a write path', () => {
    warmPhoneGeo()
    const started = process.hrtime.bigint()
    for (let i = 0; i < 20_000; i++) lookupPhoneGeo('+1310203000' + (i % 10))
    const msPerLookup = Number(process.hrtime.bigint() - started) / 1e6 / 20_000
    // Warm lookups measure ~0.2µs. A regression past 0.1ms means the memoization broke and we
    // are back on the library's uncached ~6ms path, which would make the inline hook untenable.
    expect(msPerLookup).toBeLessThan(0.1)
  })
})
