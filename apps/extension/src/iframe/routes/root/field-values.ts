// apps/extension/src/iframe/routes/root/field-values.ts

import type { ParsedCompany, ParsedPerson } from '../../../lib/parsers/types'
import { uploadAvatarFromUrl } from '../../trpc'
import { AVATAR_SYSTEM_ATTR, type EntityType } from './types'

/**
 * Parse-result → field-value-map adapters used by the Save handlers. Also
 * houses the cross-entity converters that drive "Save as company" on a
 * person parse (and vice-versa), and the FILE-field avatar upload helper.
 */

export function buildContactFieldValues(person: ParsedPerson): Record<string, unknown> {
  return {
    // full_name is FieldType.NAME — a server-derived view over first_name +
    // last_name (see field-value-helpers.ts resolveNameFieldDisplayValue /
    // field-value-queries.ts NAME hydration). Writing to it directly would
    // fail validation (NAME expects { firstName, lastName }, not a string),
    // and it's redundant — setting first/last populates the displayName
    // column and synthesises the NAME value on read.
    first_name: person.firstName,
    last_name: person.lastName,
    primary_email: person.primaryEmail,
    phone: person.phone,
    notes: person.notes,
    // externalId is multi-value (options.multi=true in the registry). Send
    // the capture's identifier as a single-element array so the server
    // writes one FieldValue row; future recaptures append via mode: 'add'.
    external_id: [person.externalId],
    // contact_avatar is a FILE field — populated separately via
    // buildAvatarFieldValue() which resolves the URL to an asset ref.
  }
}

export function buildCompanyFieldValues(company: ParsedCompany): Record<string, unknown> {
  return {
    company_name: company.name,
    company_domain: company.domain,
    company_notes: company.notes,
    company_x_follower_count: company.xFollowerCount,
    // externalId is multi-value — see buildContactFieldValues.
    external_id: [company.externalId],
    // company_logo is a FILE field — populated separately via
    // buildAvatarFieldValue() which resolves the URL to an asset ref.
  }
}

/**
 * Convert a parsed person into company-shaped data. Used when the user
 * clicks the secondary "Save as company" button on a profile that Auxx
 * detected as a contact (e.g. a Twitter org account or an ambiguous page).
 * The externalId is passed through as-is — the same URL always produces the
 * same identifier, so re-captures will still dedup against the original.
 */
export function personToCompany(person: ParsedPerson | null): ParsedCompany | null {
  if (!person) return null
  const joinedFromParts = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const name = person.fullName ?? (joinedFromParts.length > 0 ? joinedFromParts : undefined)
  return {
    name,
    avatarUrl: person.avatarUrl,
    notes: person.notes,
    externalId: person.externalId,
    xFollowerCount: person.xFollowerCount,
  }
}

/** Inverse of `personToCompany` — for the "Save as contact" button on a company parse. */
export function companyToPerson(company: ParsedCompany | null): ParsedPerson | null {
  if (!company) return null
  const parts = (company.name ?? '').split(/\s+/).filter(Boolean)
  const firstName = parts[0]
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined
  return {
    firstName,
    lastName,
    fullName: company.name,
    avatarUrl: company.avatarUrl,
    notes: company.notes,
    externalId: company.externalId,
  }
}

export async function buildAvatarFieldValue(
  entityType: EntityType,
  avatarUrl: string | undefined
): Promise<Record<string, unknown>> {
  if (!avatarUrl) return {}
  try {
    const { ref } = await uploadAvatarFromUrl({ url: avatarUrl, entityType })
    return { [AVATAR_SYSTEM_ATTR[entityType]]: { ref } }
  } catch (err) {
    // Avatar upload is best-effort — fall through to saving the record
    // without the image. LinkedIn CDN URLs expire; a 403 here is expected.
    console.warn('[auxx] avatar upload failed, saving without', err)
    return {}
  }
}
