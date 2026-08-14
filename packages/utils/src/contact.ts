// packages/utils/src/contact.ts

import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js'

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
 * Normalize a phone number to E.164 (`+4930901820`).
 *
 * This is THE phone normalizer — the write-path validator
 * (`fieldValueSchemas.phone`), read-side `normalizeForLookup` and the import
 * resolver all funnel through it, so write and lookup normalization can never
 * drift apart.
 *
 * National numbers with no country code are parsed as `defaultCountry`
 * (US in v1; org-profile-based inference is the v2 lever). Validation uses
 * `isValid()` — the per-country numbering-plan check, not just a length check —
 * so impossible numbers are rejected rather than blessed with a `+1`.
 *
 * @param phone Raw user/CSV/provider input, any formatting.
 * @param defaultCountry Country assumed for numbers written without a `+` prefix.
 * @returns The E.164 string, or `null` when the input is unparseable or invalid.
 */
export const formatPhoneNumber = (
  phone: string | null,
  defaultCountry: CountryCode = 'US'
): string | null => {
  if (!phone) return null

  const parsed = parsePhoneNumberFromString(phone.trim(), defaultCountry)

  return parsed?.isValid() ? parsed.number : null
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
export const formatComplexName = (name: string | null): string | null => {
  if (!name) return null
  return name
    .split(/[\s-']/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .trim()
}

export const formatCityName = (city: string | null): string | null => {
  if (!city) return null
  return city
    .toLowerCase()
    .split(/[\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim()
}
