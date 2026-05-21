// apps/chat-widget/src/views/kb/kb-article-view.tsx
//
// Inline article reader. Pulls the rendered HTML from /api/kb/articles/:id
// and dangerously sets it into a Preact root — the renderer already escaped
// and allowlisted everything server-side, so the body is safe to inject.
// Click on a `data-auxx-article-link` element pushes another kb-article
// frame instead of letting the browser navigate.

import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useNavStack } from '~/navigation/nav-stack-context'
import { type KbArticleResponse, kbApi } from '~/transport/kb-api'

interface KbArticleViewProps {
  channelId: string
  articleId: string
}

export function KbArticleView({ channelId, articleId }: KbArticleViewProps) {
  const nav = useNavStack()
  const [data, setData] = useState<KbArticleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Stable reference so the nav object identity (which churns on every stack
  // mutation) doesn't retrigger the fetch effect.
  const navRef = useRef(nav)
  navRef.current = nav

  useEffect(() => {
    let cancelled = false
    setError(null)
    setData(null)
    kbApi(channelId)
      .getArticle(articleId)
      .then((d) => {
        if (cancelled) return
        setData(d)
        // Refresh the frame title now that the real article title is known —
        // matters most for internal-link pushes that started as "Loading…".
        navRef.current.replace({
          id: d.id,
          label: d.title,
          view: 'kb-article',
          params: { articleId: d.id },
        })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load article')
      })
    return () => {
      cancelled = true
    }
  }, [channelId, articleId])

  // Capture clicks on internal article references so they push a new
  // kb-article frame instead of triggering the browser's navigation.
  const handleClick = useCallback(
    (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
      const target = event.target as Element | null
      const anchor = target?.closest('a[data-auxx-article-link]') as HTMLAnchorElement | null
      if (!anchor) return
      event.preventDefault()
      const nextId = anchor.getAttribute('data-auxx-article-link')
      if (!nextId) return
      nav.push({
        id: nextId,
        label: 'Loading…',
        view: 'kb-article',
        params: { articleId: nextId },
      })
    },
    [nav]
  )

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-sm text-[color:var(--color-muted)]'>
        {error}
      </div>
    )
  }
  if (!data) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-xs text-[color:var(--color-muted)]'>
        Loading…
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto bg-[color:var(--color-bg)]'>
      <div
        className='auxx-kb-article px-5 py-4'
        onClick={handleClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is server-sanitized by renderArticleHtml (allowlisted tags + escaped text + URL allowlist).
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  )
}
