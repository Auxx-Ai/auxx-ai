// packages/utils/src/contact.ts

import { type CountryCode, type PhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js'

export type ContactName = {
  id?: string
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * Get display name for a contact (prioritizes name field, then firstName/lastName, then email)
 */
export const getContactDisplayName = (contact: ContactName | null | undefined): string | null => {
  if (!contact) return null

  const { name, firstName, lastName, email } = contact

  // Priority: name > firstName+lastName > email
  if (name?.trim()) {
    return name.trim()
  }

  if (firstName || lastName) {
    return `${firstName || ''} ${lastName || ''}`.trim()
  }

  if (email?.trim()) {
    return email.trim()
  }

  return null
}
export const getFullName = (contact: ContactName): string => {
  const { firstName, lastName, email, phone, id } = contact
  if (firstName || lastName) {
    return `${firstName || ''} ${lastName || ''}`.trim()
  }
  if (email) {
    return email.trim()
  }
  if (phone) {
    return phone.trim()
  }
  if (id) {
    return `Contact #${id}`
  }
  return '<No Name>'
}
export const getInitials = (contact: ContactName | null, empty: string = 'U'): string => {
  if (!contact) return empty

  const first = contact.firstName?.charAt(0) || ''
  const last = contact.lastName?.charAt(0) || ''

  if (first || last) {
    return `${first}${last}`.trim().toUpperCase()
  }

  return contact.email?.charAt(0)?.toUpperCase() || empty
}
export const getInitialsFromName = (name: string | null, empty: string = 'U'): string => {
  if (!name || name.length === 0) return empty
  return name[0]!.charAt(0).toUpperCase()
}

/**
 * Parse a phone number and return it only if it is genuinely valid.
 *
 * This is THE parse-and-validate gate. Everything that needs to know "is this a
 * real number" funnels through it — {@link formatPhoneNumber} for the E.164
 * string, `phoneSearchPatterns` for digit patterns, `lookupPhoneGeo` for the
 * numbering-plan prefixes — so the notion of "valid" can never drift between
 * the write path, search and enrichment.
 *
 * 🔴 **`isValid()`, not merely "parsed".** `parsePhoneNumberFromString` happily
 * returns a `PhoneNumber` for a fragment: `('415', 'US')` yields `+1415`.
 * `isValid()` is the per-country numbering-plan check, so impossible numbers are
 * rejected rather than blessed with a `+1`.
 *
 * Returns the parsed object rather than a string because callers need different
 * parts of it — `.number`, `.nationalNumber`, `.countryCallingCode`, `.country`.
 * Reach for {@link formatPhoneNumber} when all you want is the E.164 string.
 *
 * ⚠️ Deliberately NOT used by the two display formatters
 * (`field-values/converters/phone.ts`, the composer's `identifier-model.ts`):
 * those format whatever parses and fall back to the raw string, so gating them
 * on validity would stop them rendering already-stored legacy values.
 *
 * @param phone Raw user/CSV/provider input, any formatting.
 * @param defaultCountry Region a national (no `+`) number is parsed against.
 * @returns The parsed number, or `null` when unparseable or invalid.
 */
export const parseValidPhone = (
  phone: string | null | undefined,
  defaultCountry: CountryCode = 'US'
): PhoneNumber | null => {
  if (!phone) return null

  const parsed = parsePhoneNumberFromString(phone.trim(), defaultCountry)

  return parsed?.isValid() ? parsed : null
}

/**
 * Normalize a phone number to E.164 (`+4930901820`).
 *
 * This is THE phone normalizer — the write-path validator
 * (`fieldValueSchemas.phone`), read-side `normalizeForLookup` and the import
 * resolver all funnel through it, so write and lookup normalization can never
 * drift apart.
 *
 * National numbers with no country code are parsed as `defaultCountry`
 * (US in v1; org-profile-based inference is the v2 lever). Validity is
 * {@link parseValidPhone}'s `isValid()` gate.
 *
 * @param phone Raw user/CSV/provider input, any formatting.
 * @param defaultCountry Country assumed for numbers written without a `+` prefix.
 * @returns The E.164 string, or `null` when the input is unparseable or invalid.
 */
export const formatPhoneNumber = (
  phone: string | null,
  defaultCountry: CountryCode = 'US'
): string | null => parseValidPhone(phone, defaultCountry)?.number ?? null

/** ISO-3166 region a national (no `+`) phone number is parsed against. */
export type PhoneRegion = CountryCode

/** Region assumed when nothing better is known. Matches `formatPhoneNumber`'s own default. */
export const DEFAULT_PHONE_REGION: PhoneRegion = 'US'

/**
 * Region implied by an E.164 identifier — typically a channel's OWN sending
 * number.
 *
 * This is the region to hand {@link formatPhoneNumber} when normalizing a
 * national (no `+`) number for that channel. It is both cheaper and more correct
 * than the org profile: an org with a German and a US number must parse
 * `030 901820` differently depending on which one it is sending from, and there
 * is no per-send country on the profile to express that.
 *
 * 🔴 **Getting this wrong is silent.** E.164 drops the trunk prefix, so parsing
 * a Berlin number against `US` does not fail loudly — it yields `null` (caller
 * sees "invalid") or, worse, a plausible `+1` number for input that happens to
 * fit the NANP. Prefer a real region over the default whenever one is available.
 *
 * Falls back to {@link DEFAULT_PHONE_REGION} when the identifier is absent (every
 * email channel) or does not parse.
 */
export const regionFromIdentifier = (identifier?: string | null): PhoneRegion => {
  if (!identifier) return DEFAULT_PHONE_REGION
  return parsePhoneNumberFromString(identifier.trim())?.country ?? DEFAULT_PHONE_REGION
}

export const formatStreetAddress = (street: string | null): string | null => {
  if (!street || typeof street !== 'string') return null // Handle empty or invalid input

  // Trim extra spaces and ensure proper capitalization
  return street
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()) // Capitalize first letter of each word
    .replace(/\s+/g, ' ') // Ensure single spaces between words
    .replace(/(\d+)\s+([A-Za-z])/g, '$1 $2') // Ensure space after street number
    .replace(/\b(St|Ave|Rd|Dr|Blvd|Ln|Ct|Pl|Pkwy|Way|Sq)\b/gi, (match) => match.toUpperCase()) // Standardize street suffixes
}

export const formatCompanyName = (name: string | null): string | null => {
  if (!name) return null
  return name.trim()
}
// `formatComplexName` and `formatCityName` were deleted here (2026-09-03). Both split
// on a character class and re-joined on ' ', which DELETED every hyphen and
// apostrophe they touched (`Creighton-Taylor` -> `Creighton Taylor`, `O'Brien` ->
// `O Brien`), and both lower-cased the remainder, flattening `MacIver` -> `Maciver`
// and `McAllen` -> `Mcallen`. Neither had a single caller anywhere in the repo.
// Use `toDisplayCase` from `./name-case` for person names — it repairs casing ONLY
// when the input is entirely upper- or lower-case, so it can never flatten a
// deliberate capital. See plans/records/contact-name-casing-plan.md §4.
