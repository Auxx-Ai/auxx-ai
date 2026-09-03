// packages/lib/src/companies/enrichment/derive-domain.ts
// Turn a `company_website` value into the registrable domain enrichment fetches against.
//
// This is what makes the website field mean something. Before it, `company_domain` had
// exactly ONE writer in the whole codebase (`ingest/companies/find-or-create.ts`, the mail
// path), so a company that did not arrive by email could never be enriched no matter what
// the user typed into it.
//
// The exclusions are the mail path's, reused rather than reimplemented: a free-mail
// provider or an edu/gov TLD is no more a company website than it is a company email
// domain. The OWN-domain check is deliberately NOT applied — an inbound address on our own
// domain is us, but a user typing a URL onto a company record is being deliberate.

import { getDomain } from 'tldts'
import { isExcludedTld, isPersonalDomain, normalizeDomain } from '../../ingest/domain/classifier'

/**
 * First entry of a multi-value `company_website` that yields a usable registrable domain.
 *
 * Accepts both what the URL field stores (`https://acme.com/about`) and what users paste
 * into it anyway (`acme.com`, `www.acme.com`), because the field is `URL`-typed but the
 * import path writes whatever the CSV column held.
 */
export function domainFromWebsite(
  website: readonly (string | null | undefined)[] | null | undefined
): string | null {
  if (!website) return null

  for (const raw of website) {
    const domain = domainFromUrl(raw)
    if (domain) return domain
  }

  return null
}

/** Registrable domain (eTLD+1) for one URL-ish string, or null when it is unusable. */
export function domainFromUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // `new URL` needs a scheme, so a bare host gets one. A string that ALREADY carries a
  // scheme must not: prefixing `mailto:sales@acme.com` yields
  // `https://mailto:sales@acme.com`, which parses cleanly with `mailto:sales` as userinfo
  // and `acme.com` as the host. That silently turned an email address into a website.
  //
  // The digit test separates a scheme from a bare host with a port — `acme.com:8080` is
  // not an `acme.com:` scheme, and rejecting it would be wrong.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?![0-9])/i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null
  const candidate = hasScheme ? trimmed : `https://${trimmed}`

  let host: string
  try {
    host = new URL(candidate).hostname
  } catch {
    return null
  }

  if (host.length === 0) return null

  const domain = getDomain(host)
  if (!domain) return null

  const normalized = normalizeDomain(domain)
  if (isPersonalDomain(normalized)) return null
  if (isExcludedTld(normalized)) return null

  return normalized
}
