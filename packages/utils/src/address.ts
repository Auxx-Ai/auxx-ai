// packages/utils/src/address.ts
//
// Shared, client-safe `AddressStruct` helpers: canonical display formatting, geocoder-input
// formatting, and a deterministic local parser that turns free-typed/pasted address text into
// struct candidates. Zero dependencies, no Node APIs — usable from web client, lib, and worker.
// See plans/address-field/01-single-input-address-field.md §4 for the design this implements.

/** Canonical `AddressStruct` shape (matches `packages/lib/src/custom-fields/types.ts`). */
export interface AddressStructValue {
  street1: string
  street2?: string
  city: string
  state: string
  zipCode: string
  country: string // ISO alpha-2
  raw?: string
  lat?: number
  lng?: number
  geocodedAt?: string
}

export interface AddressParseCandidate {
  struct: AddressStructValue
  confidence: number // 0..1
  countrySource: 'token' | 'postal-shape' | 'default'
}

// --- Country table (copied from apps/web/src/constants/countries.ts — utils must stay
// dependency-free, so this is a data copy, not an import) ---------------------------------

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'DE', name: 'Germany' },
  { code: 'ES', name: 'Spain' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'IE', name: 'Ireland' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NO', name: 'Norway' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TR', name: 'Turkey' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'US', name: 'United States' },
]

const CODE_TO_NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]))
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  deutschland: 'DE',
}
const NAME_TO_CODE = new Map<string, string>([
  ...COUNTRIES.map((c): [string, string] => [c.name.toLowerCase(), c.code]),
  ...Object.entries(COUNTRY_NAME_ALIASES),
])

// US state + Canadian province abbreviation <-> name tables (state anchor for the parser).

const US_STATE_ABBR = new Map<string, string>([
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
])

const CA_PROVINCE_ABBR = new Map<string, string>([
  ['AB', 'Alberta'],
  ['BC', 'British Columbia'],
  ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'],
  ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'],
  ['ON', 'Ontario'],
  ['PE', 'Prince Edward Island'],
  ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'],
  ['YT', 'Yukon'],
])

const US_STATE_NAME_TO_ABBR = new Map(
  [...US_STATE_ABBR].map(([abbr, name]): [string, string] => [name.toLowerCase(), abbr])
)
const CA_PROVINCE_NAME_TO_ABBR = new Map(
  [...CA_PROVINCE_ABBR].map(([abbr, name]): [string, string] => [name.toLowerCase(), abbr])
)

function stateTablesFor(
  country: string
): { abbr: Map<string, string>; name: Map<string, string> } | undefined {
  if (country === 'US') return { abbr: US_STATE_ABBR, name: US_STATE_NAME_TO_ABBR }
  if (country === 'CA') return { abbr: CA_PROVINCE_ABBR, name: CA_PROVINCE_NAME_TO_ABBR }
  return undefined
}

/**
 * Matches a trailing state/province at the end of `words` — abbreviation ("TX") or full name,
 * including multi-word names ("New York", "British Columbia") — returning the normalized
 * abbreviation and how many words it consumed.
 */
function matchTrailingState(
  words: string[],
  country: string
): { abbr: string; consumed: number } | undefined {
  const tables = stateTablesFor(country)
  if (!tables || words.length === 0) return undefined
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const suffix = words
      .slice(words.length - take)
      .join(' ')
      .replace(/[.,]+$/, '')
    if (take === 1 && tables.abbr.has(suffix.toUpperCase())) {
      return { abbr: suffix.toUpperCase(), consumed: 1 }
    }
    const byName = tables.name.get(suffix.toLowerCase())
    if (byName) return { abbr: byName, consumed: take }
  }
  return undefined
}

/** Normalizes a free-standing state segment ("Texas", "TX") to its abbreviation when known. */
function normalizeState(value: string, country: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const match = matchTrailingState(trimmed.split(/\s+/).filter(Boolean), country)
  return match && match.consumed === trimmed.split(/\s+/).filter(Boolean).length
    ? match.abbr
    : trimmed
}

function countryNameFor(codeOrName: string): string {
  const trimmed = codeOrName.trim()
  if (!trimmed) return ''
  return CODE_TO_NAME.get(trimmed.toUpperCase()) ?? trimmed
}

/**
 * Canonical one-liner (decision #10): `"123 Main St, Apt 4, Austin, TX 78701"`. Country
 * rendered as full name only when it differs from `opts.domesticCountry` (alpha-2, case
 * insensitive); with no `domesticCountry` the country name is always appended.
 * `opts.country: 'name' | 'code' | 'omit'` overrides that behavior. Profile-aware ordering:
 * DE renders `"Straße Nr, PLZ Stadt"` (zip before city, no state). Returns `''` when every
 * part is empty — callers can `|| null`.
 */
export function formatAddress(
  a: Partial<AddressStructValue>,
  opts?: { domesticCountry?: string; country?: 'name' | 'code' | 'omit' }
): string {
  const street1 = (a.street1 ?? '').trim()
  const street2 = (a.street2 ?? '').trim()
  const city = (a.city ?? '').trim()
  const state = (a.state ?? '').trim()
  const zipCode = (a.zipCode ?? '').trim()
  const countryCode = (a.country ?? '').trim()
  const isDE = countryCode.toUpperCase() === 'DE'

  const segments = isDE
    ? [street1, street2, [zipCode, city].filter(Boolean).join(' ')]
    : [street1, street2, city, [state, zipCode].filter(Boolean).join(' ')]

  const countryText = resolveCountryDisplay(countryCode, opts)
  const parts = [...segments, countryText].filter((p) => p.trim().length > 0)
  return parts.length > 0 ? parts.join(', ') : ''
}

function resolveCountryDisplay(
  countryCode: string,
  opts?: { domesticCountry?: string; country?: 'name' | 'code' | 'omit' }
): string {
  if (!countryCode) return ''
  if (opts?.country === 'omit') return ''
  if (opts?.country === 'code') return countryCode.toUpperCase()
  if (opts?.country === 'name') return countryNameFor(countryCode)
  if (opts?.domesticCountry) {
    return opts.domesticCountry.trim().toUpperCase() === countryCode.toUpperCase()
      ? ''
      : countryNameFor(countryCode)
  }
  return countryNameFor(countryCode)
}

/** Flat comma-join of all components — geocoder input, NOT a display formatter. */
export function formatAddressForGeocode(a: Partial<AddressStructValue>): string {
  return [a.street1, a.street2, a.city, a.state, a.zipCode, a.country]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

// --- Parser --------------------------------------------------------------------------------

const UNIT_RE = /^(#|apt\.?|apartment|suite|ste\.?|unit|floor|fl\.?|whg\.?|wohnung)\b/i
const CA_POSTAL_RE = /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/
const UK_POSTAL_RE = /\b[A-Za-z]{1,2}\d[A-Za-z0-9]?\s?\d[A-Za-z]{2}\b/
const DIGIT5_RE = /\b\d{5}(?:-\d{4})?\b/

interface PostalShapeMatch {
  type: 'CA' | 'UK' | 'DIGIT5'
  text: string
  index: number
}

interface RawAssignment {
  street1: string
  street2: string
  city: string
  state: string
  zipCode: string
  confidence: number
}

function preprocess(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function matchCountryToken(s: string): string | undefined {
  const cleaned = s.replace(/[.,]/g, '').trim()
  if (!cleaned) return undefined
  const upper = cleaned.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper) && CODE_TO_NAME.has(upper)) return upper
  return NAME_TO_CODE.get(cleaned.toLowerCase())
}

/** Strips a trailing country name/code (1-3 words) off the end of the text, if present. */
function stripTrailingCountry(text: string): { rest: string; code?: string } {
  const words = text.split(/\s+/).filter(Boolean)
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const suffix = words.slice(words.length - take).join(' ')
    const code = matchCountryToken(suffix)
    if (code) {
      const rest = words
        .slice(0, words.length - take)
        .join(' ')
        .replace(/,+$/, '')
        .trim()
      return { rest, code }
    }
  }
  return { rest: text }
}

function lastMatch(re: RegExp, text: string): { text: string; index: number } | undefined {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const matches = [...text.matchAll(global)]
  const last = matches[matches.length - 1]
  return last ? { text: last[0], index: last.index ?? 0 } : undefined
}

function findPostalShape(text: string): PostalShapeMatch | undefined {
  const ca = lastMatch(CA_POSTAL_RE, text)
  if (ca) return { type: 'CA', ...ca }
  const uk = lastMatch(UK_POSTAL_RE, text)
  if (uk) return { type: 'UK', ...uk }
  const d5 = lastMatch(DIGIT5_RE, text)
  if (d5) return { type: 'DIGIT5', ...d5 }
  return undefined
}

/** US-vs-DE 5-digit zip tie-break: number-first street = US-like, number-last = DE-like. */
function tieBreakUSDE(
  fullText: string,
  zipIndex: number,
  defaultCountry: string
): { country: 'US' | 'DE'; decisive: boolean } {
  const preZip = fullText.slice(0, zipIndex).replace(/[,\s]+$/, '')
  const numberFirst = /^\s*\d+[A-Za-z]?\b/.test(fullText)
  const numberLast = !numberFirst && /\d+[A-Za-z]?$/.test(preZip)
  if (numberFirst) return { country: 'US', decisive: true }
  if (numberLast) return { country: 'DE', decisive: true }
  return { country: defaultCountry.toUpperCase() === 'DE' ? 'DE' : 'US', decisive: false }
}

function resolveCountry(
  countryToken: string | undefined,
  shape: PostalShapeMatch | undefined,
  textAfterCountry: string,
  defaultCountry: string
): { country: string; countrySource: AddressParseCandidate['countrySource'] } {
  if (countryToken) return { country: countryToken, countrySource: 'token' }
  if (shape?.type === 'CA') return { country: 'CA', countrySource: 'postal-shape' }
  if (shape?.type === 'UK') return { country: 'GB', countrySource: 'postal-shape' }
  if (shape?.type === 'DIGIT5') {
    const tie = tieBreakUSDE(textAfterCountry, shape.index, defaultCountry)
    return { country: tie.country, countrySource: tie.decisive ? 'postal-shape' : 'default' }
  }
  return { country: defaultCountry, countrySource: 'default' }
}

function isUnitLike(seg: string): boolean {
  return UNIT_RE.test(seg.trim())
}

function splitCityState(remainder: string, country: string): { city: string; state: string } {
  const words = remainder.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { city: '', state: '' }
  const match = matchTrailingState(words, country)
  // A state match must leave at least one word for the city — "New York" alone is a city,
  // not a bare state.
  if (match && match.consumed < words.length) {
    return { city: words.slice(0, words.length - match.consumed).join(' '), state: match.abbr }
  }
  return { city: remainder.trim(), state: '' }
}

function extractTrailingState(text: string, country: string): { rest: string; state: string } {
  const words = text.split(/\s+/).filter(Boolean)
  const match = matchTrailingState(words, country)
  if (match && match.consumed < words.length) {
    return { rest: words.slice(0, words.length - match.consumed).join(' '), state: match.abbr }
  }
  return { rest: text, state: '' }
}

/**
 * Uppercases the first letter of each word (and hyphen part) of a city name — "austin" →
 * "Austin", "new york" → "New York", "winston-salem" → "Winston-Salem". Never lowercases the
 * rest, so deliberately-cased input ("McAllen", "AUSTIN") passes through untouched.
 */
function capitalizeCity(city: string): string {
  return city.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

function splitLastWordAsCity(text: string): { street: string; city: string } {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return { street: text.trim(), city: '' }
  return { street: words.slice(0, -1).join(' '), city: words[words.length - 1] as string }
}

/** Assigns street1/street2 from the comma segments preceding city/locality (max 2 candidates). */
function assignStreet(
  leadingSegs: string[]
): { street1: string; street2: string; confidence: number }[] {
  if (leadingSegs.length === 0) return [{ street1: '', street2: '', confidence: 0.5 }]
  if (leadingSegs.length === 1) {
    return [{ street1: leadingSegs[0] as string, street2: '', confidence: 0.9 }]
  }
  if (leadingSegs.length === 2) {
    const [a, b] = leadingSegs as [string, string]
    if (isUnitLike(b)) return [{ street1: a, street2: b, confidence: 0.9 }]
    return [
      { street1: `${a}, ${b}`, street2: '', confidence: 0.6 },
      { street1: a, street2: b, confidence: 0.55 },
    ]
  }
  const last = leadingSegs[leadingSegs.length - 1] as string
  if (isUnitLike(last)) {
    return [{ street1: leadingSegs.slice(0, -1).join(', '), street2: last, confidence: 0.7 }]
  }
  return [{ street1: leadingSegs.join(', '), street2: '', confidence: 0.6 }]
}

function assignFromSegments(
  text: string,
  shape: PostalShapeMatch | undefined,
  profile: 'DE' | 'default',
  country: string
): RawAssignment[] {
  const segs = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const foundIdx = shape ? segs.findIndex((s) => s.includes(shape.text)) : -1
  const idx = foundIdx >= 0 ? foundIdx : segs.length - 1
  const localitySeg = segs[idx] ?? ''
  const localityConfidence = shape ? 1 : 0.7

  if (profile === 'DE') {
    let zipCode: string
    let city: string
    if (shape && localitySeg.startsWith(shape.text)) {
      zipCode = shape.text
      city = localitySeg.slice(shape.text.length).trim()
    } else {
      const m = /^(\S+)\s+(.*)$/.exec(localitySeg)
      zipCode = m?.[1] ?? localitySeg
      city = m?.[2]?.trim() ?? ''
    }
    const leadingSegs = segs.slice(0, idx)
    return assignStreet(leadingSegs).map((s) => ({
      ...s,
      city,
      state: '',
      zipCode,
      confidence: Math.min(s.confidence, localityConfidence),
    }))
  }

  const zipCode = shape?.text ?? ''
  const stateRemainder = shape ? localitySeg.replace(shape.text, '').trim() : localitySeg.trim()
  const cityIdx = idx - 1

  // `cityIdx >= 1` (not `>= 0`): a distinct city segment only exists when there's also a
  // street segment before it. With just [street, locality] (cityIdx === 0) the city has to be
  // split out of the locality remainder below — segs[cityIdx] there IS the street, not a city.
  if (cityIdx >= 1 && !isUnitLike(segs[cityIdx] as string)) {
    const leadingSegs = segs.slice(0, cityIdx)
    return assignStreet(leadingSegs).map((s) => ({
      ...s,
      city: segs[cityIdx] as string,
      state: normalizeState(stateRemainder, country),
      zipCode,
      confidence: Math.min(s.confidence, localityConfidence),
    }))
  }

  const { city, state } = splitCityState(stateRemainder, country)
  const leadingSegs = cityIdx >= 0 ? segs.slice(0, cityIdx + 1) : segs.slice(0, idx)
  return assignStreet(leadingSegs).map((s) => ({
    ...s,
    city,
    state,
    zipCode,
    confidence: Math.min(s.confidence, localityConfidence),
  }))
}

function assignFromWords(
  text: string,
  shape: PostalShapeMatch | undefined,
  profile: 'DE' | 'default',
  country: string
): RawAssignment {
  if (!shape) {
    const { street, city } = splitLastWordAsCity(text)
    return { street1: street, street2: '', city, state: '', zipCode: '', confidence: 0.4 }
  }

  const before = text.slice(0, shape.index).trim()
  const after = text.slice(shape.index + shape.text.length).trim()

  if (profile === 'DE') {
    return {
      street1: before,
      street2: '',
      city: after,
      state: '',
      zipCode: shape.text,
      confidence: 0.65,
    }
  }

  const { rest: beforeMinusState, state } = extractTrailingState(before, country)
  const { street, city } = splitLastWordAsCity(beforeMinusState)
  return { street1: street, street2: '', city, state, zipCode: shape.text, confidence: 0.55 }
}

/**
 * Parses free-typed/pasted address text into up to 2 struct candidates (decision #2/#3):
 * anchor-based, right-to-left (country token → postal-code shape → state/province token),
 * per-country profile ordering (US/CA/UK vs DE), deterministic, no network/Node APIs.
 * `defaultCountry` resolves the US-vs-DE 5-digit zip collision and any address with no other
 * country signal (org business-address country, decision #8).
 */
export function parseAddress(
  text: string,
  opts: { defaultCountry: string }
): AddressParseCandidate[] {
  const defaultCountry = (opts.defaultCountry || 'US').toUpperCase()
  const preprocessed = preprocess(text)
  if (!preprocessed) return []

  const { rest: textAfterCountry, code: countryToken } = stripTrailingCountry(preprocessed)
  const shape = findPostalShape(textAfterCountry)
  const { country, countrySource } = resolveCountry(
    countryToken,
    shape,
    textAfterCountry,
    defaultCountry
  )
  const profile: 'DE' | 'default' = country === 'DE' ? 'DE' : 'default'
  const sourcePenalty =
    countrySource === 'token' ? 1 : countrySource === 'postal-shape' ? 0.95 : 0.85

  const hasCommas = textAfterCountry.includes(',')
  const assignments = hasCommas
    ? assignFromSegments(textAfterCountry, shape, profile, country)
    : [assignFromWords(textAfterCountry, shape, profile, country)]

  return assignments
    .slice(0, 2)
    .map(({ street1, street2, city, state, zipCode, confidence }) => ({
      struct: {
        street1,
        street2: street2 || undefined,
        city: capitalizeCity(city),
        state,
        zipCode,
        country,
      },
      confidence: Math.round(confidence * sourcePenalty * 100) / 100,
      countrySource,
    }))
    .sort((a, b) => b.confidence - a.confidence)
}
