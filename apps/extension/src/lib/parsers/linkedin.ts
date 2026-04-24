// apps/extension/src/lib/parsers/linkedin.ts

import { findBySelectorAsync, textOf } from '../dom'
import { linkedInExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParsedPerson, type ParseResult } from './types'

/**
 * LinkedIn (regular profile) parser — DOM-only. Voyager API access is
 * deferred to v2 (see plan 09). Selector lists deliberately try the
 * current 2026 layout first, fall back to older variants. See plan 18 §6.
 */

const NAME_SELECTORS = [
  'main h1.text-heading-xlarge',
  'main section.pv-top-card h1',
  'main [data-section="topcard"] h1',
  'main [data-view-name="profile-card"] h1',
  'main h1',
]

const HEADLINE_SELECTORS = [
  'main .text-body-medium.break-words',
  'main section.pv-top-card .text-body-medium',
  'main [data-section="topcard"] .text-body-medium',
  'main [data-generated-suggestion-target]',
]

const AVATAR_SELECTORS = [
  'main img.pv-top-card-profile-picture__image',
  'main section.pv-top-card img[alt*="profile photo" i]',
  'main img[alt][src*="profile-displayphoto"]',
]

function profileSlugFromUrl(url: URL): string | null {
  const m = url.pathname.match(/^\/in\/([^/?#]+)/)
  return m?.[1] ?? null
}

function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function isLikelyAvatar(url: string | null | undefined): boolean {
  if (!url || !url.startsWith('http')) return false
  // LinkedIn ghost / placeholder asset.
  if (url.includes('static.licdn.com/aero-v1/sc/h/')) return false
  return true
}

async function waitForHydration(): Promise<void> {
  // LinkedIn hydrates the top card lazily on SPA nav. Wait up to 3s for
  // any known name selector to appear — faster than polling per-selector.
  await findBySelectorAsync(NAME_SELECTORS.join(', '), { timeoutMs: 3000 })
}

function extractName(): string | null {
  for (const sel of NAME_SELECTORS) {
    const text = textOf(document.querySelector(sel))
    // Guard against grabbing a huge concatenated <h1> that wraps the whole hero.
    if (text && text.length > 0 && text.length < 100) return text
  }
  // Fallback: document title is `"<Name> | LinkedIn"` on profile pages.
  const title = document.title.split('|')[0]?.trim()
  return title && title !== 'LinkedIn' ? title : null
}

function extractHeadline(): string | null {
  for (const sel of HEADLINE_SELECTORS) {
    const text = textOf(document.querySelector(sel))
    if (text) return text
  }
  return null
}

function extractAvatar(): string | null {
  for (const sel of AVATAR_SELECTORS) {
    const el = document.querySelector<HTMLImageElement>(sel)
    const src = el?.getAttribute('src')
    if (src && isLikelyAvatar(src)) return src
  }
  return null
}

export async function parseLinkedIn(): Promise<ParseResult> {
  const slug = profileSlugFromUrl(new URL(location.href))
  if (!slug) return EMPTY_PARSE_RESULT

  await waitForHydration()

  const fullName = extractName()
  if (!fullName) return EMPTY_PARSE_RESULT

  const headline = extractHeadline()
  const avatarUrl = extractAvatar()
  const about = textOf(document.querySelector('#about ~ div .pv-shared-text-with-see-more'))

  const notesParts = [headline, about].filter(Boolean) as string[]
  const notes = notesParts.length > 0 ? notesParts.join('\n\n') : undefined

  const person: ParsedPerson = {
    ...splitName(fullName),
    fullName,
    avatarUrl: avatarUrl ?? undefined,
    notes,
    externalId: linkedInExternalId(slug),
  }

  return { people: [person], companies: [] }
}

export function linkedInFingerprint(url: URL): string {
  return `linkedin${url.pathname}`
}
