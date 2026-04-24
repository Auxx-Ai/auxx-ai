// apps/extension/src/lib/parsers/facebook.ts

import { queryXpath, queryXpathAll, waitForXpath } from '../dom'
import { facebookExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParseResult } from './types'

/**
 * Facebook parser — most defensive of all hosts. Facebook's DOM ships no
 * stable test IDs; every selector is positional XPath + content heuristic.
 * One entry point handles both person and company (Page) profiles, dispatching
 * by detected type. Ported from folk's bundled `parseFacebookProfile`.
 *
 * The parser only succeeds when the user has About → Contact and Basic Info
 * visible. The iframe surfaces a hint before dispatching on profiles where
 * the URL doesn't already include that tab — see root-route.tsx.
 */

const PROFILE_ROOT = '//div[@role="main"]/div[1]/div[2]//descendant::div[count(child::*) >= 3][1]'

const CONTACT_INFO_ROOT =
  "(//div[@role='main']/div[4]/div[2]/div/div[1]//span[@dir='auto'])[2]/ancestor::*[count(child::*) >= 3][1]"

// Multilingual match for company-ish Page subtitles (en/es/pt/it/fr/de).
const COMPANY_WORDS =
  /\b(company|business|brand|store|shop|restaurant[e]?|caf[eé]|bar|hotel|club|organisation|organization|organización|organização|organizzazione|entreprise|empresa|firma|societ[eà]|sociedade|unternehmen|verein|association|asocia[cç][ií]on|associazione)\b/iu

const PHONE_RE = /(?:\+\d{1,4}[\s-]?|\(\d{3}\)\s?)[\d\s\-().]{7,15}/g
const EMAIL_RE =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

// Facebook wraps external links: /l.php?u=ENCODED_URL&fbclid=…
const FB_REDIRECT_RE = /[?&]u=([^&]+)/

function detectType(): 'person' | 'company' {
  // Persons have a Friends link in the top card. Pages don't.
  const hasFriends = queryXpathAll(`${PROFILE_ROOT}//a[@role="link"]`)
    .map((a) => a.getAttribute('href'))
    .some((href) => href?.endsWith('/friends/') || href?.endsWith('sk=friends'))
  if (hasFriends) return 'person'

  const subtitleParts =
    queryXpath(`${CONTACT_INFO_ROOT}//ul/div//span[@dir="auto"][1]`)
      ?.textContent?.split('·')
      .map((s) => s.trim()) ?? []
  return subtitleParts.some((s) => COMPANY_WORDS.test(s)) ? 'company' : 'person'
}

function getAvatar(): string | undefined {
  return queryXpath(`${PROFILE_ROOT}//svg//image`)?.getAttribute('xlink:href') ?? undefined
}

function getName(): string {
  const svg = queryXpath(`${PROFILE_ROOT}//svg`)
  return (svg as SVGElement | null)?.getAttribute('aria-label') ?? ''
}

function extractRealUrl(wrapped: string): string | null {
  const m = wrapped.match(FB_REDIRECT_RE)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

function getExternalLinks(): string[] {
  return queryXpathAll(`${CONTACT_INFO_ROOT}/div//*[@role="link"]`)
    .map((el) => {
      const href = el.getAttribute('href')
      if (!href) return null
      const real = extractRealUrl(href)
      if (!real) return null
      return real.replace(/[?&]fbclid=[^&]*(&|$)/, '$1').replace(/[?&]$/, '')
    })
    .filter((x): x is string => x !== null)
}

function getPhonesAndEmails(): { phones: string[]; emails: string[] } {
  const items = queryXpathAll(`${CONTACT_INFO_ROOT}//ul/div`)
  const phones = new Set<string>()
  const emails = new Set<string>()
  for (const item of items) {
    const raw = queryXpath('.//span[@dir="auto"]', item)?.textContent ?? ''
    const compact = raw.replace(/\s/g, '')
    if (compact.match(PHONE_RE)) phones.add(raw.trim())
    if (compact.match(EMAIL_RE)) emails.add(compact)
  }
  return { phones: [...phones], emails: [...emails] }
}

function selfUrl(loc: URL): string[] {
  if (loc.pathname.includes('profile.php')) {
    const id = loc.searchParams.get('id')
    if (id) return [`https://www.facebook.com/profile.php?id=${id}`]
  }
  const vanity = loc.pathname.split('/').filter(Boolean)[0]
  return vanity ? [`https://www.facebook.com/${vanity}`] : []
}

function deriveExternalIdRaw(loc: Location): string {
  if (loc.pathname.includes('profile.php')) {
    const id = new URL(loc.href).searchParams.get('id')
    if (id) return `id:${id}`
  }
  const vanity = loc.pathname.split('/').filter(Boolean)[0]
  return vanity ? `vanity:${vanity}` : 'unknown'
}

function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function firstDomainFromUrls(urls: string[]): string | undefined {
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, '')
      if (host && !host.endsWith('facebook.com')) return host
    } catch {
      /* skip invalid */
    }
  }
  return undefined
}

function extras(extraPhones: string[], extraEmails: string[]): string[] {
  return [...extraPhones.map((p) => `Phone: ${p}`), ...extraEmails.map((e) => `Email: ${e}`)]
}

function buildNotes(parts: { urls: string[]; extras: string[] }): string | undefined {
  const lines = [
    ...parts.urls.filter((u) => !u.startsWith('https://www.facebook.com')),
    ...parts.extras,
  ]
  return lines.length ? lines.join('\n') : undefined
}

export async function parseFacebook(): Promise<ParseResult> {
  const ready = await waitForXpath(CONTACT_INFO_ROOT, { timeoutMs: 10_000 })
  if (!ready) return EMPTY_PARSE_RESULT

  const type = detectType()
  const picture = getAvatar()
  const name = getName()
  const externalLinks = getExternalLinks()
  const { phones, emails } = getPhonesAndEmails()
  const urls = [...selfUrl(new URL(location.href)), ...externalLinks]

  const externalId = facebookExternalId(deriveExternalIdRaw(location))
  const notes = buildNotes({ urls, extras: extras(phones.slice(1), emails.slice(1)) })

  if (type === 'company') {
    return {
      people: [],
      companies: [
        {
          name,
          domain: firstDomainFromUrls(externalLinks),
          avatarUrl: picture,
          notes,
          externalId,
        },
      ],
    }
  }

  return {
    people: [
      {
        ...splitName(name),
        fullName: name,
        primaryEmail: emails[0],
        phone: phones[0],
        avatarUrl: picture,
        notes,
        externalId,
      },
    ],
    companies: [],
  }
}
