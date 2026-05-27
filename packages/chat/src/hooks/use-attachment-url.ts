// packages/chat/src/hooks/use-attachment-url.ts
//
// Per-asset URL resolver for chat attachments. Hits
// `GET /api/chat/attachments/:attachmentId/url` lazily as bubbles render. Module-
// scoped cache + inflight dedup so the same asset doesn't issue parallel
// fetches across remounts or duplicate renders.
//
// URLs come back with a server-controlled `expiresAt` (1h TTL today). We
// refresh ~1 minute before that to avoid serving a stale URL that 403s mid-
// render.

import { useCallback, useEffect, useState } from 'preact/hooks'
import { chatApi } from '~/transport/chat-api'

interface CacheEntry {
  url: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string>>()

export interface AttachmentUrlState {
  url: string | null
  loading: boolean
  error: boolean
  /**
   * Force a refetch — clears the cached URL for this attachment and triggers
   * the effect to run again. Call from image `onError` or a manual retry
   * button so a transient 5xx / expired-URL doesn't strand the user behind
   * "refresh to retry."
   */
  retry: () => void
}

export function useAttachmentUrl(channelId: string, attachmentId: string): AttachmentUrlState {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<Omit<AttachmentUrlState, 'retry'>>(() => {
    const cached = cache.get(attachmentId)
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return { url: cached.url, loading: false, error: false }
    }
    return { url: null, loading: true, error: false }
  })

  const retry = useCallback(() => {
    cache.delete(attachmentId)
    inflight.delete(attachmentId)
    setState({ url: null, loading: true, error: false })
    setNonce((n) => n + 1)
  }, [attachmentId])

  useEffect(() => {
    const cached = cache.get(attachmentId)
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      if (state.url !== cached.url) setState({ url: cached.url, loading: false, error: false })
      return
    }

    let cancelled = false
    let promise = inflight.get(attachmentId)
    if (!promise) {
      promise = chatApi(channelId)
        .getAttachmentUrl(attachmentId)
        .then(({ url, expiresAt }) => {
          cache.set(attachmentId, { url, expiresAt: new Date(expiresAt).getTime() })
          inflight.delete(attachmentId)
          return url
        })
        .catch((err) => {
          inflight.delete(attachmentId)
          throw err
        })
      inflight.set(attachmentId, promise)
    }
    promise
      .then((url) => {
        if (!cancelled) setState({ url, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, error: true })
      })

    return () => {
      cancelled = true
    }
  }, [channelId, attachmentId, nonce])

  return { ...state, retry }
}
