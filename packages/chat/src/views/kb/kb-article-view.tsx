// packages/chat/src/views/kb/kb-article-view.tsx
//
// Inline article reader. Pulls the rendered HTML from /api/kb/articles/:id
// and dangerously sets it into a Preact root — the renderer already escaped
// and allowlisted everything server-side, so the body is safe to inject.
// After mount we hydrate `data-auxx-icon` placeholders into Lucide SVGs and
// wire the interactive controllers for `data-auxx-block="tabs"` and the
// single-open variant of `data-auxx-block="accordion"`.
//
// Click on a `data-auxx-article-link` element pushes another kb-article
// frame instead of letting the browser navigate.

import { getIcon } from '@auxx/ui/components/icon-data'
import { createElement, type JSX, render } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useNavStack } from '~/navigation/nav-stack-context'
import { type KbArticleResponse, kbApi } from '~/transport/kb-api'

interface KbArticleViewProps {
  channelId: string
  articleId: string
}

export function KbArticleView({ channelId, articleId }: KbArticleViewProps) {
  const nav = useNavStack()
  const containerRef = useRef<HTMLDivElement | null>(null)
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

  // After the HTML lands in the DOM, walk the placeholder spans and replace
  // them with Lucide SVGs, then attach the small interactive controllers.
  useEffect(() => {
    const root = containerRef.current
    if (!root || !data) return
    const hydratedIconSpans = hydrateIcons(root)
    const detachTabs = wireTabs(root)
    const detachAccordion = wireAccordion(root)
    return () => {
      detachTabs()
      detachAccordion()
      for (const span of hydratedIconSpans) render(null, span)
    }
  }, [data])

  // Capture clicks on internal article references so they push a new
  // kb-article frame instead of triggering the browser's navigation.
  const handleClick = useCallback(
    (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
      const target = event.target as Element | null
      const anchor = target?.closest('[data-auxx-article-link]') as HTMLElement | null
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
      <div className='flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground'>
        {error}
      </div>
    )
  }
  if (!data) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground'>
        Loading…
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto bg-[color:var(--auxx-chat-surface-loud)]'>
      <div
        ref={containerRef}
        className='auxx-kb-article px-5 py-4'
        onClick={handleClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is server-sanitized by renderArticleHtml (allowlisted tags + escaped text + URL allowlist).
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  )
}

/**
 * Walk the rendered HTML for `<span data-auxx-icon="…">` placeholders and
 * render each Lucide icon into the corresponding span via Preact's imperative
 * `render`. Returns the spans that received a hydrated tree so the cleanup
 * callback can drop them on unmount.
 */
function hydrateIcons(root: HTMLElement): Element[] {
  const spans = root.querySelectorAll<HTMLElement>('[data-auxx-icon]')
  const hydrated: Element[] = []
  spans.forEach((span) => {
    const iconId = span.getAttribute('data-auxx-icon')
    if (!iconId) return
    const item = getIcon(iconId)
    if (!item) return
    render(createElement(item.icon, { 'aria-hidden': true }), span)
    hydrated.push(span)
  })
  return hydrated
}

/**
 * Delegate clicks + arrow keys for every `[data-auxx-block="tabs"]` block so
 * `[data-auxx-tab]` buttons switch the matching `[data-auxx-tab-panel]`.
 */
function wireTabs(root: HTMLElement): () => void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-auxx-block="tabs"]'))
  const handlers: Array<{
    el: HTMLElement
    onClick: (e: Event) => void
    onKey: (e: KeyboardEvent) => void
  }> = []

  for (const container of containers) {
    const onClick = (event: Event) => {
      const target = event.target as Element | null
      const button = target?.closest('[data-auxx-tab]') as HTMLElement | null
      if (!button || !container.contains(button)) return
      const targetId = button.getAttribute('data-target')
      if (!targetId) return
      activateTab(container, targetId)
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return
      }
      const list = container.querySelector('[data-auxx-tabs-list]')
      if (!list || !(event.target instanceof Element) || !list.contains(event.target)) return
      const buttons = Array.from(list.querySelectorAll<HTMLElement>('[data-auxx-tab]'))
      if (buttons.length === 0) return
      const currentIndex = buttons.findIndex((b) => b.getAttribute('data-active') === 'true')
      let nextIndex = currentIndex
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length
      else if (event.key === 'ArrowLeft')
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = buttons.length - 1
      const next = buttons[nextIndex]
      const targetId = next?.getAttribute('data-target')
      if (!targetId) return
      event.preventDefault()
      activateTab(container, targetId)
      next.focus()
    }
    container.addEventListener('click', onClick)
    container.addEventListener('keydown', onKey)
    handlers.push({ el: container, onClick, onKey })
  }

  return () => {
    for (const { el, onClick, onKey } of handlers) {
      el.removeEventListener('click', onClick)
      el.removeEventListener('keydown', onKey)
    }
  }
}

function activateTab(container: HTMLElement, targetId: string) {
  const buttons = container.querySelectorAll<HTMLElement>('[data-auxx-tab]')
  buttons.forEach((b) => {
    const active = b.getAttribute('data-target') === targetId
    b.setAttribute('data-active', String(active))
    b.setAttribute('aria-selected', String(active))
    b.setAttribute('tabindex', active ? '0' : '-1')
  })
  const panels = container.querySelectorAll<HTMLElement>('[data-auxx-tab-panel]')
  panels.forEach((p) => {
    const active = p.getAttribute('data-id') === targetId
    p.setAttribute('data-active', String(active))
    if (active) p.removeAttribute('hidden')
    else p.setAttribute('hidden', '')
  })
}

/**
 * Enforce single-open behavior for accordion containers marked with
 * `data-allow-multiple="false"`. Native `<details>` handles toggle on its
 * own; we only need to close siblings when one opens.
 */
function wireAccordion(root: HTMLElement): () => void {
  const containers = Array.from(
    root.querySelectorAll<HTMLElement>('[data-auxx-block="accordion"][data-allow-multiple="false"]')
  )
  const handlers: Array<{ el: HTMLElement; onToggle: (e: Event) => void }> = []
  for (const container of containers) {
    const onToggle = (event: Event) => {
      const target = event.target as HTMLDetailsElement | null
      if (!target || target.tagName !== 'DETAILS' || !target.open) return
      const siblings = container.querySelectorAll<HTMLDetailsElement>('[data-auxx-accordion-item]')
      siblings.forEach((s) => {
        if (s !== target && s.open) s.open = false
      })
    }
    // `toggle` doesn't bubble in all browsers — use capture so a single
    // listener on the container catches every child <details>.
    container.addEventListener('toggle', onToggle, true)
    handlers.push({ el: container, onToggle })
  }
  return () => {
    for (const { el, onToggle } of handlers) {
      el.removeEventListener('toggle', onToggle, true)
    }
  }
}
