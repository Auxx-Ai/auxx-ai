// packages/lib/src/phone-geo/lookup.ts
//
// Phone-number → city/region/country/timezone, resolved from Google's libphonenumber
// geocoding metadata as republished by `libphonenumber-geo-carrier`.
//
// ## Why this reads the package's resource files instead of calling its API
//
// `libphonenumber-geo-carrier`'s `geocoder()`/`timezones()` re-read AND re-deserialize their
// BSON resource on EVERY call — there is no cache, not even for a repeated lookup of the same
// number (measured: 5.7ms for 300 lookups of one number, 5.9ms for 300 distinct ones). That is
// ~30,000x the cost of the work and would make an inline field hook untenable.
//
// Deserializing each resource once into a plain object and walking the prefix ladder ourselves
// costs ~13ms one-time and ~0.2µs per lookup, and was verified to produce byte-identical output
// to the library's own API across 407 numbers spanning NANP, DE, FR, GB, AU, JP, BR and CA.
//
// The cost is a dependency on the package's internal `resources/` layout, which its `exports`
// map does not expose. {@link loadResource} therefore fails soft: if the layout ever changes the
// maps come back empty, every lookup returns `null`, and callers degrade to writing nothing —
// never to writing something wrong.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createScopedLogger } from '@auxx/logger'
import { deserialize } from 'bson'
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js'
import type { PhoneGeo } from './types'

const logger = createScopedLogger('phone-geo')

/**
 * Google publishes regions as bare names but cities as `City, ST`. Expanding the abbreviation
 * keeps phone-derived values in the same shape as the IP-geolocation writer
 * (`chat/visit-fields.ts`), which sources full names from ipapi/MaxMind — otherwise the same
 * contact field would read `California` or `CA` depending on which producer happened to win.
 */
const REGION_BY_CODE: Readonly<Record<string, string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
}

/**
 * Google's own region strings that are not the plain place name. `Washington State` is
 * disambiguated from `Washington D.C.` in the source data; our `region` field wants the state.
 */
const REGION_ALIASES: Readonly<Record<string, string>> = {
  'Washington State': 'Washington',
}

type PrefixMap = Record<string, string | undefined>

const geocodeMaps = new Map<string, PrefixMap | null>()
let timezoneMap: PrefixMap | null | undefined
let resourceRoot: string | null | undefined

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * Locate the package's `resources/` directory. Its `exports` map only exposes `.`, so
 * `package.json` is not resolvable — go via the main entry and strip `lib/index.js`.
 */
function getResourceRoot(): string | null {
  if (resourceRoot !== undefined) return resourceRoot
  try {
    const entry = createRequire(import.meta.url).resolve('libphonenumber-geo-carrier')
    const root = entry.replace(/lib[/\\]index\.js$/, '')
    resourceRoot = root === entry ? null : root
  } catch {
    resourceRoot = null
  }
  if (resourceRoot === null) {
    logger.warn('libphonenumber-geo-carrier resources not resolvable; phone geo disabled')
  }
  return resourceRoot
}

function loadResource(relativePath: string): PrefixMap | null {
  const root = getResourceRoot()
  if (!root) return null
  try {
    return deserialize(readFileSync(`${root}resources/${relativePath}`)) as PrefixMap
  } catch {
    // Expected for calling codes with no published geocoding data — not an error.
    return null
  }
}

function getGeocodeMap(callingCode: string): PrefixMap | null {
  const cached = geocodeMaps.get(callingCode)
  if (cached !== undefined) return cached
  const map = loadResource(`geocodes/en/${callingCode}.bson`)
  geocodeMaps.set(callingCode, map)
  return map
}

function getTimezoneMap(): PrefixMap | null {
  if (timezoneMap === undefined) timezoneMap = loadResource('timezones.bson')
  return timezoneMap
}

/**
 * Walk `digits` from the longest prefix down to `minLength`, returning the first hit.
 *
 * This ladder is the whole mechanism: NANP geocoding data is keyed at both NPA (3 digits,
 * state-level) and NPA-NXX (6 digits, city-level), so the longest match is the most specific
 * answer available for that number.
 */
function matchLongestPrefix(
  map: PrefixMap | null,
  digits: string,
  minLength: number
): string | undefined {
  if (!map) return undefined
  for (let length = digits.length; length >= minLength; length--) {
    const hit = map[digits.slice(0, length)]
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Split Google's geocode string into city + region.
 *
 * `Los Angeles, CA` is a city with a state; a bare `California`, `Ontario` or `Berlin` is a
 * region with no city at all. Storing the raw string in either field would be wrong in one of
 * those two cases, so the comma is load-bearing.
 */
function splitGeocode(raw: string): { city?: string; region?: string } {
  const match = raw.match(/^(.*),\s*([A-Z]{2})$/)
  if (match?.[1] && match[2]) {
    return { city: match[1].trim(), region: REGION_BY_CODE[match[2]] ?? match[2] }
  }
  const region = raw.trim()
  return region ? { region: REGION_ALIASES[region] ?? region } : {}
}

/**
 * Preload the geocoding tables so the first real lookup does not pay the ~13ms deserialize.
 *
 * Call once at process start (worker/web bootstrap), the way `apps/api` calls `initGeo()`.
 * Safe to call repeatedly — subsequent calls are no-ops. Never throws.
 */
export function warmPhoneGeo(): void {
  // `1` is the NANP table and covers the overwhelming majority of our numbers; other calling
  // codes load lazily on first use.
  getGeocodeMap('1')
  getTimezoneMap()
}

/**
 * Derive city/region/country/timezone from an E.164 phone number.
 *
 * Pure and synchronous — no database, no network. Returns `null` when the number is unparseable
 * or nothing at all could be derived.
 *
 * @param e164 A phone number. Anything `libphonenumber-js` can parse works, but callers should
 *   pass E.164; values read from `Participant.identifier` are only digit-stripped and must go
 *   through `formatPhoneNumber` from `@auxx/utils` first.
 * @param defaultCountry Region assumed for numbers written without a `+` prefix.
 */
export function lookupPhoneGeo(
  e164: string | null | undefined,
  defaultCountry: CountryCode = 'US'
): PhoneGeo | null {
  if (!e164) return null

  const parsed = parsePhoneNumberFromString(e164.trim(), defaultCountry)
  if (!parsed?.isValid()) return null

  const callingCode = String(parsed.countryCallingCode)
  const nationalNumber = parsed.nationalNumber

  const result: PhoneGeo = {}

  const geocode = matchLongestPrefix(getGeocodeMap(callingCode), nationalNumber, 1)
  if (geocode) Object.assign(result, splitGeocode(geocode))

  if (parsed.country) {
    try {
      result.country = countryNames.of(parsed.country) ?? undefined
    } catch {
      // Non-region code (e.g. libphonenumber's `001` for non-geographic numbers) — skip.
    }
  }

  // Timezones are keyed by calling code + national number, so the ladder must never shorten past
  // the calling code itself — `1` alone maps to all 42 NANP zones.
  const zones = matchLongestPrefix(
    getTimezoneMap(),
    callingCode + nationalNumber,
    callingCode.length
  )?.split('&')
  // Only an unambiguous prefix yields a usable answer. A UK mobile spans Europe/London,
  // Europe/Guernsey and Europe/Isle_of_Man; picking the first would be a coin flip presented
  // as a fact.
  if (zones?.length === 1 && zones[0]) result.timezone = zones[0]

  return Object.keys(result).length > 0 ? result : null
}

/** Test-only: drop the memoized tables so a test can exercise the cold path. */
export function __resetPhoneGeoForTests(): void {
  geocodeMaps.clear()
  timezoneMap = undefined
  resourceRoot = undefined
}
