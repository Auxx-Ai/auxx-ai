// apps/extension/src/lib/parsers/sales-navigator.ts

import { findBySelectorAsync, textOf } from '../dom'
import { salesNavExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParsedPerson, type ParseResult } from './types'

/**
 * Sales Navigator profile parser — DOM-only.
 *
 * Sales Navigator URLs look like
 *   https://www.linkedin.com/sales/lead/<encoded-id>,<view>,<extra>
 * The <encoded-id> serves as our salesnav external ID.
 */

function leadIdFromUrl(url: URL): string | null {
  const m = url.pathname.match(/^\/sales\/lead\/([^,/]+)/)
  return m?.[1] ?? null
}

function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function isLikelyAvatar(url: string | null | undefined): boolean {
  return !!url && url.startsWith('http')
}

export async function parseSalesNavigator(): Promise<ParseResult> {
  const leadId = leadIdFromUrl(new URL(location.href))
  if (!leadId) return EMPTY_PARSE_RESULT

  const card = await findBySelectorAsync(
    '[data-anonymize="person-name"], section[data-test-lead-profile]',
    { timeoutMs: 5000 }
  )
  if (!card) return EMPTY_PARSE_RESULT

  const nameEl = document.querySelector('[data-anonymize="person-name"]')
  const fullName = textOf(nameEl)
  if (!fullName) return EMPTY_PARSE_RESULT

  const headlineEl = document.querySelector('[data-anonymize="headline"]')
  const headline = textOf(headlineEl)

  const companyEl = document.querySelector('[data-anonymize="company-name"]')
  const company = textOf(companyEl)

  const avatar =
    document.querySelector<HTMLImageElement>('[data-anonymize="headshot-photo"]')?.src ??
    document.querySelector<HTMLImageElement>('img[alt*="profile photo" i]')?.src

  const notesParts = [headline, company ? `at ${company}` : null].filter(Boolean) as string[]
  const notes = notesParts.length > 0 ? notesParts.join(' ') : undefined

  const person: ParsedPerson = {
    ...splitName(fullName),
    fullName,
    avatarUrl: isLikelyAvatar(avatar) ? avatar : undefined,
    notes,
    externalId: salesNavExternalId(leadId),
  }

  return { people: [person], companies: [] }
}

export function salesNavigatorFingerprint(url: URL): string {
  return `salesnav${url.pathname}`
}
