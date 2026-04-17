// packages/lib/src/ingest/domain/classifier.ts

import { getDomain, getPublicSuffix } from 'tldts'
import { getOrgCache } from '../../cache/singletons'
import { EXCLUDED_TLDS } from './excluded-tlds'
import { PERSONAL_EMAIL_DOMAINS } from './personal-domains'

/**
 * Extract the registrable domain (eTLD+1) from an email address.
 * `john@mail.sales.acme.co.uk` → `acme.co.uk`.
 * Returns null if the input is not a valid email or the domain can't be parsed.
 */
export function extractRegistrableDomain(email: string): string | null {
  const atIdx = email.lastIndexOf('@')
  if (atIdx < 0) return null
  const host = email
    .slice(atIdx + 1)
    .toLowerCase()
    .trim()
  if (!host) return null
  const domain = getDomain(host)
  return domain ?? null
}

/**
 * Canonical domain normalization: trim, lowercase, strip leading `www.`.
 * Applied to both stored domains and query inputs so membership tests line up
 * regardless of how the user entered the value.
 */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

/** True if the domain is on the canonical free-email-provider list. */
export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(normalizeDomain(domain))
}

/** True if the domain's public suffix matches an excluded TLD (edu/gov/mil/etc). */
export function isExcludedTld(domain: string): boolean {
  const suffix = getPublicSuffix(domain)
  if (!suffix) return false
  return EXCLUDED_TLDS.has(suffix.toLowerCase())
}

/**
 * Returns the organization's own domains (Redis-cached via `orgProfile`),
 * normalized via `normalizeDomain`. Callers can use the set directly in
 * `.has(...)` checks without re-normalizing.
 */
export async function getOwnDomains(orgId: string): Promise<Set<string>> {
  const profile = await getOrgCache().get(orgId, 'orgProfile')
  return new Set((profile.domains ?? []).map(normalizeDomain))
}

export async function isOwnDomain(orgId: string, domain: string): Promise<boolean> {
  const own = await getOwnDomains(orgId)
  return own.has(normalizeDomain(domain))
}

/**
 * Should we auto-create/link a company for this email?
 * Returns the normalized registrable domain when applicable, or null to skip.
 *
 * When the caller already has the org's own-domains set (e.g. cached per-batch),
 * pass it in via `ownDomains` to avoid a redundant org-cache read per participant.
 */
export async function classifyForCompany(
  orgId: string,
  email: string,
  ownDomains?: Set<string>
): Promise<string | null> {
  const domain = extractRegistrableDomain(email)
  if (!domain) return null
  if (isPersonalDomain(domain)) return null
  if (isExcludedTld(domain)) return null
  const own = ownDomains ?? (await getOwnDomains(orgId))
  if (own.has(normalizeDomain(domain))) return null
  return domain
}
