// apps/extension/src/lib/parsers/twitter.ts

import { z } from 'zod'
import { textOf } from '../dom'
import { twitterExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParsedPerson, type ParseResult, splitName } from './types'

/**
 * Twitter / X parsers — both use DOM-only scraping, no API.
 *
 *   parseTwitterProfile → JSON-LD injected at
 *     `[data-testid="UserProfileSchema-test"]` on `/<username>` routes.
 *     Twitter sometimes leaves stale schema tags behind during SPA nav, so
 *     we wait for `link[rel=canonical]` to catch up with `location.pathname`
 *     and pop the last matching script node.
 *
 *   parseTwitterSearch → scrapes `[data-testid="UserCell"]` rows from both
 *     `/search?f=user` results AND the Followers/Following/Likes/Retweets
 *     modal (`[aria-modal="true"]`). Hard-capped at 20 rows per parse —
 *     Twitter only renders ~12 per page on initial paint and the iframe
 *     save path is serial.
 */

// ─── JSON-LD schema ────────────────────────────────────────────

const TwitterImageSchema = z
  .object({
    contentUrl: z.string().optional(),
    thumbnailUrl: z.string().optional(),
  })
  .optional()

const TwitterHomeLocationSchema = z
  .object({
    name: z.union([z.string(), z.unknown()]).optional(),
  })
  .optional()

const TwitterInteractionStatSchema = z
  .object({
    interactionType: z.union([z.string(), z.object({}).passthrough(), z.unknown()]).optional(),
    userInteractionCount: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough()

const TwitterProfileSchema = z.object({
  mainEntity: z.object({
    additionalName: z.string().optional(),
    name: z.string().optional(),
    givenName: z.string().optional(),
    description: z.string().optional(),
    image: TwitterImageSchema,
    homeLocation: TwitterHomeLocationSchema,
    interactionStatistic: z.array(TwitterInteractionStatSchema).optional(),
  }),
  relatedLink: z.array(z.string()).optional(),
})

// ─── Helpers ───────────────────────────────────────────────────

const DEFAULT_AVATAR_RE = /\/default_profile_images\/default_profile/

function filterDefaultAvatar(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  if (DEFAULT_AVATAR_RE.test(url)) return undefined
  return url
}

function coerceLocation(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function waitForCanonicalMatch(timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const href = document.querySelector('link[rel=canonical]')?.getAttribute('href')
    if (href) {
      try {
        const canon = new URL(href)
        if (location.pathname.toLowerCase().startsWith(canon.pathname.toLowerCase())) return
      } catch {
        /* bad canonical — treat as not-yet-hydrated */
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function findAllBySelectorAsync(
  selector: string,
  { timeoutMs = 4000, root = document as ParentNode } = {}
): Promise<Element[]> {
  const immediate = Array.from(root.querySelectorAll(selector))
  if (immediate.length > 0) return immediate
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const els = Array.from(root.querySelectorAll(selector))
      if (els.length > 0) {
        observer.disconnect()
        clearTimeout(timer)
        resolve(els)
      }
    })
    observer.observe(root instanceof Document ? root.body : (root as Node), {
      childList: true,
      subtree: true,
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve([])
    }, timeoutMs)
  })
}

function collapseWhitespace(s: string | null | undefined): string | undefined {
  if (!s) return undefined
  const out = s.replace(/\s+/g, ' ').trim()
  return out.length > 0 ? out : undefined
}

/**
 * Parse X's follower count from JSON-LD `interactionStatistic`. X tags
 * followers with `interactionType` either as the string `https://schema.org/FollowAction`
 * or as a nested `{'@type': 'FollowAction'}` object, depending on release.
 */
function followerCountFromStats(
  stats: Array<{ interactionType?: unknown; userInteractionCount?: unknown }> | undefined
): number | undefined {
  if (!stats) return undefined
  for (const stat of stats) {
    const t = stat.interactionType
    const isFollow =
      (typeof t === 'string' && t.toLowerCase().includes('followaction')) ||
      (typeof t === 'object' &&
        t !== null &&
        String((t as Record<string, unknown>)['@type'] ?? '')
          .toLowerCase()
          .includes('followaction'))
    if (!isFollow) continue
    const raw = stat.userInteractionCount
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= 0) return Math.round(n)
  }
  return undefined
}

/**
 * DOM fallback — read the follower count out of the `/<user>/followers` or
 * `/<user>/verified_followers` link that X renders under the bio. The count
 * is the first `<span>` text; we accept shorthand like "1.2K" / "12.3M".
 */
function followerCountFromDom(username: string): number | undefined {
  const selectors = [
    `a[href="/${username}/verified_followers"] span`,
    `a[href="/${username}/followers"] span`,
  ]
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel)
    const raw = el?.textContent?.trim()
    if (!raw) continue
    const parsed = parseShorthandCount(raw)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** `"1,234"` → 1234, `"1.2K"` → 1200, `"12.3M"` → 12_300_000, `"1.2B"` → 1_200_000_000. */
function parseShorthandCount(raw: string): number | undefined {
  const m = raw.replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?$/i)
  if (!m) return undefined
  const base = Number(m[1])
  if (!Number.isFinite(base)) return undefined
  const mult =
    m[2]?.toUpperCase() === 'B'
      ? 1e9
      : m[2]?.toUpperCase() === 'M'
        ? 1e6
        : m[2]?.toUpperCase() === 'K'
          ? 1e3
          : 1
  return Math.round(base * mult)
}

// ─── Profile parser ────────────────────────────────────────────

export async function parseTwitterProfile(): Promise<ParseResult> {
  await waitForCanonicalMatch()

  const nodes = await findAllBySelectorAsync('[data-testid=UserProfileSchema-test]', {
    timeoutMs: 3000,
  })
  const node = nodes.pop()
  if (!node) return EMPTY_PARSE_RESULT

  let parsed: z.infer<typeof TwitterProfileSchema>
  try {
    parsed = TwitterProfileSchema.parse(JSON.parse(node.textContent ?? ''))
  } catch {
    return EMPTY_PARSE_RESULT
  }

  const username = parsed.mainEntity.additionalName
  if (!username) return EMPTY_PARSE_RESULT

  const fullName = parsed.mainEntity.name ?? parsed.mainEntity.givenName ?? undefined
  const avatar = filterDefaultAvatar(
    parsed.mainEntity.image?.contentUrl ?? parsed.mainEntity.image?.thumbnailUrl
  )
  const location = coerceLocation(parsed.mainEntity.homeLocation?.name)
  const externalLinks = (parsed.relatedLink ?? []).filter((u) => !u.startsWith('https://t.co'))

  // ParsedPerson doesn't yet carry `urls` / `addresses` — fold both into notes
  // joined by newlines, same as LinkedIn fuses headline + about. See plan §2a.
  const notesParts: string[] = []
  if (parsed.mainEntity.description) notesParts.push(parsed.mainEntity.description.trim())
  if (location) notesParts.push(location)
  notesParts.push(`https://x.com/${username}`)
  for (const link of externalLinks) notesParts.push(link)
  const notes = notesParts.length > 0 ? notesParts.join('\n') : undefined

  const followerCount =
    followerCountFromStats(parsed.mainEntity.interactionStatistic) ?? followerCountFromDom(username)

  const person: ParsedPerson = {
    ...(fullName ? splitName(fullName) : {}),
    fullName,
    avatarUrl: avatar,
    notes,
    externalId: twitterExternalId(username),
    xFollowerCount: followerCount,
  }

  return { people: [person], companies: [] }
}

// ─── Search / list parser ──────────────────────────────────────

const SEARCH_CELL_SELECTOR =
  '[data-testid="primaryColumn"] [data-testid="UserCell"], ' +
  '[aria-modal="true"] [data-testid="UserCell"]'

const SEARCH_CELL_CAP = 20

export async function parseTwitterSearch(): Promise<ParseResult> {
  const cells = await findAllBySelectorAsync(SEARCH_CELL_SELECTOR, { timeoutMs: 5000 })
  if (cells.length === 0) return EMPTY_PARSE_RESULT

  const people = cells
    .slice(0, SEARCH_CELL_CAP)
    .map((cell) => extractSearchPerson(cell))
    .filter((p): p is ParsedPerson => p !== null)

  return { people, companies: [] }
}

function extractSearchPerson(cell: Element): ParsedPerson | null {
  const link = cell.querySelector<HTMLAnchorElement>('a[role=link]')
  if (!link) return null

  let username: string | null = null
  try {
    username = new URL(link.href).pathname.replace(/^\//, '').split('/')[0] ?? null
  } catch {
    return null
  }
  if (!username) return null

  const nameEl = cell.querySelector('a[role=link] span')
  const fullName = collapseWhitespace(textOf(nameEl))

  const avatarEl = cell.querySelector<HTMLImageElement>('[data-testid^="UserAvatar"] img')
  const avatar = filterDefaultAvatar(avatarEl?.src)

  // Twitter's bio — when present — is the last text-dir block inside the cell.
  const dirBlocks = cell.querySelectorAll('div[dir]')
  const bio = collapseWhitespace(textOf(dirBlocks[dirBlocks.length - 1] ?? null))

  const notesParts: string[] = []
  if (bio) notesParts.push(bio)
  notesParts.push(`https://x.com/${username}`)
  const notes = notesParts.join('\n')

  return {
    ...(fullName ? splitName(fullName) : {}),
    fullName,
    avatarUrl: avatar,
    notes,
    externalId: twitterExternalId(username),
  }
}

export function twitterProfileFingerprint(url: URL): string {
  return `twitter-profile${url.pathname}`
}

export function twitterSearchFingerprint(url: URL): string {
  return `twitter-search${url.pathname}${url.search}`
}
