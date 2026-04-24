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

const TwitterProfileSchema = z.object({
  mainEntity: z.object({
    additionalName: z.string().optional(),
    name: z.string().optional(),
    givenName: z.string().optional(),
    description: z.string().optional(),
    image: TwitterImageSchema,
    homeLocation: TwitterHomeLocationSchema,
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

  const person: ParsedPerson = {
    ...(fullName ? splitName(fullName) : {}),
    fullName,
    avatarUrl: avatar,
    notes,
    externalId: twitterExternalId(username),
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
