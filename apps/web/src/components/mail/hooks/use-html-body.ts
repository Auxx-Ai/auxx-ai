// apps/web/src/components/mail/hooks/use-html-body.ts
'use client'

import { useCallback, useRef, useState } from 'react'

interface HtmlBodyState {
  html: string | null
  isLoading: boolean
  error: string | null
}

/**
 * In-memory cache keyed by messageId to survive collapse/expand cycles.
 *
 * Bounded and clearable, both for the same reason (plan 45 §1.6): it holds full
 * HTML bodies, it is module-level so it outlives every route change, and it is
 * NOT keyed by lens — so without {@link clearHtmlBodyCache} a viewer who loses
 * `full` keeps every body they had already opened for the tab's lifetime.
 */
const htmlBodyCache = new Map<string, string>()

/**
 * FIFO bound. Insertion-ordered `Map`, so the oldest key is the first one
 * `keys()` yields. A single long thread can hold a few hundred KB per body;
 * unbounded, a day of triage is a memory profile nobody has looked at.
 */
const HTML_BODY_CACHE_MAX = 50

function cacheHtmlBody(messageId: string, html: string): void {
  htmlBodyCache.set(messageId, html)
  while (htmlBodyCache.size > HTML_BODY_CACHE_MAX) {
    const oldest = htmlBodyCache.keys().next().value
    if (oldest === undefined) break
    htmlBodyCache.delete(oldest)
  }
}

/**
 * Drop every cached body. Called from `use-mail-sync`'s `visibility:changed`
 * handler — a revoke has to take the bodies with it.
 *
 * This only stops a body being re-served on the next expand: a body already
 * rendered lives in the hook's `useState`, and what actually removes it from the
 * screen is the lens refresh in the same handler, which makes `thread-messages`
 * render the redaction banner instead and unmount this hook.
 */
export function clearHtmlBodyCache(): void {
  htmlBodyCache.clear()
}

/**
 * Lazy-loads an inbound message HTML body from object storage.
 * Returns cached HTML on subsequent calls for the same messageId.
 */
export function useHtmlBody(messageId: string | undefined) {
  const [state, setState] = useState<HtmlBodyState>({
    html: messageId ? (htmlBodyCache.get(messageId) ?? null) : null,
    isLoading: false,
    error: null,
  })

  // Track the current fetch to avoid duplicate requests
  const fetchingRef = useRef(false)

  const fetchHtml = useCallback(async () => {
    if (!messageId) return

    // Return cached result
    const cached = htmlBodyCache.get(messageId)
    if (cached) {
      setState({ html: cached, isLoading: false, error: null })
      return
    }

    if (fetchingRef.current) return
    fetchingRef.current = true
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const html = await fetchBodyHtml(messageId)
      cacheHtmlBody(messageId, html)
      setState({ html, isLoading: false, error: null })
    } catch (err) {
      setState({
        html: null,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load HTML body',
      })
    } finally {
      fetchingRef.current = false
    }
  }, [messageId])

  return { ...state, fetchHtml }
}

/**
 * Fetches the HTML body for a message:
 * 1. Gets a signed URL from the app route
 * 2. Downloads the HTML from the signed URL
 * 3. Retries once if the signed URL is expired
 */
async function fetchBodyHtml(messageId: string): Promise<string> {
  const html = await attemptFetch(messageId)
  return html
}

async function attemptFetch(messageId: string): Promise<string> {
  // Step 1: Get signed URL from app route
  const res = await fetch(`/api/messages/${messageId}/body`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to get body URL (${res.status})`)
  }

  const { signedUrl } = (await res.json()) as { signedUrl: string }

  // Step 2: Fetch the actual HTML from the signed URL
  const htmlRes = await fetch(signedUrl)
  if (!htmlRes.ok) {
    // Retry once if signed URL expired (403 from S3)
    if (htmlRes.status === 403) {
      const retryRes = await fetch(`/api/messages/${messageId}/body`)
      if (!retryRes.ok) throw new Error('Failed to refresh body URL')

      const { signedUrl: freshUrl } = (await retryRes.json()) as { signedUrl: string }
      const retryHtmlRes = await fetch(freshUrl)
      if (!retryHtmlRes.ok) throw new Error('Failed to fetch HTML body after retry')
      return retryHtmlRes.text()
    }
    throw new Error(`Failed to fetch HTML body (${htmlRes.status})`)
  }

  return htmlRes.text()
}
