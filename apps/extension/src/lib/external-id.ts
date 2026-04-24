// apps/extension/src/lib/external-id.ts

/**
 * Stable cross-source identifier helpers.
 *
 * Stored as the single `externalId` TEXT field value on a record. Used for
 * dedup before creating a new contact/company from a parsed page.
 */

export type ExternalIdSource =
  | 'gmail'
  | 'linkedin'
  | 'linkedin-company'
  | 'salesnav'
  | 'twitter'
  | 'instagram'
  | 'tiktok'
  | 'whatsapp'
  | 'meet'
  | 'facebook'

export function buildExternalId(source: ExternalIdSource, raw: string): string {
  const v = raw.trim()
  if (!v) throw new Error(`buildExternalId: empty value for ${source}`)
  return `${source}:${normalize(source, v)}`
}

function normalize(source: ExternalIdSource, raw: string): string {
  switch (source) {
    case 'gmail':
    case 'twitter':
    case 'instagram':
    case 'tiktok':
      return raw.toLowerCase()
    // LinkedIn slugs and Sales Navigator IDs preserve case as LinkedIn returns them.
    case 'linkedin':
    case 'linkedin-company':
    case 'salesnav':
    case 'facebook':
      return raw
    case 'whatsapp':
      return raw.replace(/[^\d+]/g, '')
    case 'meet':
      return raw
  }
}

export function gmailExternalId(email: string): string {
  return buildExternalId('gmail', email)
}

export function linkedInExternalId(slug: string): string {
  return buildExternalId('linkedin', slug)
}

export function linkedInCompanyExternalId(slug: string): string {
  return buildExternalId('linkedin-company', slug)
}

export function salesNavExternalId(profileId: string): string {
  return buildExternalId('salesnav', profileId)
}
