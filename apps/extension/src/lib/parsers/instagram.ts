// apps/extension/src/lib/parsers/instagram.ts

import { z } from 'zod'
import { textOf, waitForCondition } from '../dom'
import { instagramExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParsedPerson, type ParseResult, splitName } from './types'

/**
 * Instagram profile parser.
 *
 * Primary strategy: the unauthenticated web API
 * (`/api/v1/users/web_profile_info/`). The `X-IG-App-ID` header token is
 * inlined in the page HTML — we grep it out of `document.body.outerHTML`.
 *
 * Fallback strategy: DOM scrape of the profile header when the API is
 * unavailable (missing token, 429, network failure). Fallback extracts
 * display name (h2), avatar, and bio so a degraded parse still returns a
 * rich record, not just a username stub.
 */

// ─── API schema ────────────────────────────────────────────────

const WebProfileInfoSchema = z.object({
  data: z.object({
    user: z.object({
      full_name: z.string().optional().nullable(),
      biography: z.string().optional().nullable(),
      profile_pic_url: z.string().optional().nullable(),
      profile_pic_url_hd: z.string().optional().nullable(),
      external_url: z.string().optional().nullable(),
    }),
  }),
})

// ─── Helpers ───────────────────────────────────────────────────

function usernameFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/?#]+)/)
  return match?.[1] ?? null
}

function findAppId(): string | null {
  return document.body.outerHTML.match(/"X-IG-App-ID":"(\d+)"/)?.[1] ?? null
}

function buildNotes(bio: string | null | undefined, externalUrl: string | null | undefined) {
  const parts: string[] = []
  if (bio?.trim()) parts.push(bio.trim())
  if (externalUrl?.trim()) parts.push(externalUrl.trim())
  return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * Fetch an Instagram CDN image from within the content script (instagram.com
 * origin) and return a base64 data URL. Rendering the raw CDN URL from the
 * extension iframe's `chrome-extension://` origin fails — the `_nc_sid`
 * signed variants 403 on cross-origin Referer. Folk sidesteps this with a
 * blob URL; we use a data URL because our preview card lives in a separate
 * iframe origin where blob URLs scoped to instagram.com are unreachable.
 */
async function fetchImageAsDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' })
    if (!res.ok) return undefined
    const blob = await res.blob()
    if (blob.size === 0) return undefined
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const out = typeof reader.result === 'string' ? reader.result : undefined
        resolve(out)
      }
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

// ─── Primary strategy: web API ─────────────────────────────────

async function tryWebApi(username: string): Promise<ParsedPerson | undefined> {
  const appId = findAppId()
  if (!appId) return undefined

  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers: { 'x-ig-app-id': appId }, credentials: 'include' }
    )
    if (!res.ok) return undefined
    const json = await res.json()
    const parsed = WebProfileInfoSchema.safeParse(json)
    if (!parsed.success) return undefined
    const user = parsed.data.data.user

    const fullName = user.full_name?.trim() || undefined
    const avatarUrl = user.profile_pic_url_hd?.trim() || user.profile_pic_url?.trim() || undefined
    const avatarPreviewUrl = avatarUrl ? await fetchImageAsDataUrl(avatarUrl) : undefined

    return {
      ...(fullName ? splitName(fullName) : {}),
      fullName,
      avatarUrl,
      avatarPreviewUrl,
      notes: buildNotes(user.biography, user.external_url),
      externalId: instagramExternalId(username),
    }
  } catch {
    return undefined
  }
}

// ─── Fallback strategy: DOM scrape ─────────────────────────────

async function tryDomFallback(username: string): Promise<ParsedPerson> {
  const header = document.querySelector('[role="main"] header, main header')
  const displayName =
    textOf(header?.querySelector('h2')) || textOf(header?.querySelector('h1')) || undefined
  const avatarEl = header?.querySelector<HTMLImageElement>('img')
  const avatarUrl = avatarEl?.src?.trim() || undefined
  const avatarPreviewUrl = avatarUrl ? await fetchImageAsDataUrl(avatarUrl) : undefined

  // The bio sits as a <span> or <div> after the action row; Instagram's
  // layout frequently changes, so we lift the first text-heavy descendant
  // that isn't the display name.
  const bioCandidate = Array.from(header?.parentElement?.querySelectorAll('span, div') ?? [])
    .map((el) => textOf(el))
    .find(
      (t) => t.length > 10 && t.length < 500 && t !== displayName && !t.includes(`@${username}`)
    )

  const fullName = displayName && displayName !== username ? displayName : undefined

  return {
    ...(fullName ? splitName(fullName) : {}),
    fullName,
    avatarUrl,
    avatarPreviewUrl,
    notes: buildNotes(bioCandidate ?? null, null),
    externalId: instagramExternalId(username),
  }
}

// ─── Entry point ───────────────────────────────────────────────

export async function parseInstagramProfile(): Promise<ParseResult> {
  const username = usernameFromPath(location.pathname)
  if (!username) return EMPTY_PARSE_RESULT

  // Wait for SPA hydration — the h2/h1 in the main header should match the
  // URL slug. Profile→profile nav rewrites the header asynchronously.
  await waitForCondition(
    () => {
      const el = document.querySelector<HTMLElement>(
        '[role="main"] header h2, [role="main"] header h1, main header h2, main header h1'
      )
      const text = el?.textContent?.trim().toLowerCase() ?? ''
      return text === username.toLowerCase()
    },
    { timeoutMs: 3000 }
  )

  const viaApi = await tryWebApi(username)
  const person = viaApi ?? (await tryDomFallback(username))
  return { people: [person], companies: [] }
}
