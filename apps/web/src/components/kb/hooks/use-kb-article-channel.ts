// apps/web/src/components/kb/hooks/use-kb-article-channel.ts
'use client'

import type { KbArticleEvent } from '@auxx/lib/kb'
import { createScopedLogger } from '@auxx/logger'
import { useCallback, useMemo, useState } from 'react'
import { getClientSessionId } from '~/components/editor/utils/client-session-id'
import { useSSE } from '~/hooks/use-sse'
import { api } from '~/trpc/react'

const logger = createScopedLogger('use-kb-article-channel')

interface UseKbArticleChannelArgs {
  articleId: string | null | undefined
  knowledgeBaseId: string | null | undefined
}

interface UseKbArticleChannelResult {
  /** True while the article is locked by Kopilot's write turn. */
  locked: boolean
}

/**
 * Subscribes the current tab to per-article realtime events. Reacts to:
 *
 * - `kb-article-resync`: full doc replacement. Invalidates the
 *   `getArticleById` tRPC query so the editor's `useArticleContent`
 *   pulls the new draft. Manual edits in another tab/session land here.
 * - `kb-article-lock`: toggles a `locked` flag the editor uses to set
 *   `editable: false` and show a "Kopilot is editing" banner.
 * - `kb-article-patch`: incremental Kopilot op. Stub for now — wired
 *   when the block-CRUD tools start firing.
 */
export function useKbArticleChannel({
  articleId,
  knowledgeBaseId,
}: UseKbArticleChannelArgs): UseKbArticleChannelResult {
  const [locked, setLocked] = useState(false)
  const utils = api.useUtils()

  const config = useMemo(() => {
    if (!articleId) return null
    return {
      url: `/api/kb/articles/${articleId}/events`,
      method: 'GET' as const,
      reconnect: true,
      events: ['connected', 'kb-article-patch', 'kb-article-resync', 'kb-article-lock'],
    }
  }, [articleId])

  const onEvent = useCallback(
    (eventType: string, data: unknown) => {
      const event = data as KbArticleEvent | { type: 'connected'; articleId: string }
      if (eventType === 'connected') return

      if (eventType === 'kb-article-resync') {
        if (!articleId || !knowledgeBaseId) return
        const evt = event as Extract<KbArticleEvent, { type: 'kb-article-resync' }>
        // The originating tab applied this content optimistically via
        // setData. Refetching here would clobber any keystrokes the user
        // typed between save-fired and resync-arrived — drop our own echo.
        if (evt.originatorSessionId === getClientSessionId()) return
        void utils.kb.getArticleById.invalidate({ id: articleId, knowledgeBaseId })
        // Refresh the list so the article store picks up any draft metadata
        // changes (title, emoji, cover) the other tab made — these don't
        // travel on the realtime event, only the content body does.
        void utils.kb.getArticles.invalidate({ knowledgeBaseId })
        return
      }

      if (eventType === 'kb-article-lock' && event.type === 'kb-article-lock') {
        setLocked(event.locked)
        return
      }

      if (eventType === 'kb-article-patch') {
        // Block-CRUD tool patches arrive here. Application is a no-op
        // until the editor exposes the apply-patch command (next infra
        // step). For now, fall back to a refetch so the doc stays in
        // sync — slower than per-op apply, but always correct.
        if (!articleId || !knowledgeBaseId) return
        void utils.kb.getArticleById.invalidate({ id: articleId, knowledgeBaseId })
        return
      }

      logger.debug('Unhandled KB article event', { eventType })
    },
    [articleId, knowledgeBaseId, utils.kb.getArticleById, utils.kb.getArticles]
  )

  useSSE(config, onEvent)

  return { locked }
}
