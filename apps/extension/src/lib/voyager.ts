// apps/extension/src/lib/voyager.ts

/**
 * LinkedIn Voyager API client.
 *
 * Auth: the JSESSIONID cookie doubles as the CSRF token. Voyager accepts any
 * authenticated session cookie as long as the `csrf-token` header matches.
 * Content scripts on linkedin.com origin can read their own cookies via
 * `document.cookie` — no separate `cookies` permission needed.
 *
 * Cache: 5-minute TTL shared across calls, keyed by URL. Stops repeated
 * profile hits while the user flips between search results / preview cards.
 * Cleared implicitly on tab reload.
 */

import type { z } from 'zod'

const CACHE_TTL_MS = 5 * 60 * 1000

type CacheEntry<T> = { promise: Promise<T | undefined>; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>()

function getJSessionId(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('JSESSIONID='))
    ?.split('=')[1]
    ?.replace(/"/g, '')
}

async function fetchAndParse<T>(url: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const csrf = getJSessionId()
  if (!csrf) {
    console.error('[auxx] voyager: missing JSESSIONID cookie')
    return undefined
  }
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'csrf-token': csrf },
      credentials: 'include',
    })
  } catch (err) {
    console.error('[auxx] voyager fetch threw', err, url)
    return undefined
  }
  if (!res.ok) {
    console.warn('[auxx] voyager: non-ok status', res.status, url)
    return undefined
  }
  let json: unknown
  try {
    json = await res.json()
  } catch (err) {
    console.error('[auxx] voyager: invalid JSON', err, url)
    return undefined
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.warn('[auxx] voyager: schema mismatch', {
      url,
      issues: parsed.error.issues,
      preview: json,
    })
    return undefined
  }
  return parsed.data
}

/**
 * Cached Voyager GET. Rerun-safe; multiple concurrent callers for the same
 * URL share one in-flight promise. Failed fetches are dropped from the cache
 * so the next call tries again.
 */
export function voyagerFetch<T>(url: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const hit = cache.get(url) as CacheEntry<T> | undefined
  if (hit) {
    if (Date.now() > hit.expiresAt) {
      cache.delete(url)
    } else {
      return hit.promise
    }
  }
  const promise = fetchAndParse(url, schema)
  cache.set(url, { promise, expiresAt: Date.now() + CACHE_TTL_MS })
  void promise.then((v) => {
    if (v === undefined) cache.delete(url)
  })
  return promise
}
