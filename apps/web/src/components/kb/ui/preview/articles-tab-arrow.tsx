// apps/web/src/components/kb/ui/preview/articles-tab-arrow.tsx
'use client'

import { ArrowDown } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useKBPreviewHint } from './preview-hint-context'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Floating chevron portal anchored above the Articles RadioTabItem (looked up
 * via [data-kb-articles-tab]). Re-measures on resize/scroll while visible.
 */
export function ArticlesTabArrow() {
  const { isVisible } = useKBPreviewHint()
  const [rect, setRect] = React.useState<Rect | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!isVisible) {
      setRect(null)
      return
    }

    let rafId: number | null = null
    let attempts = 0

    const measure = () => {
      const el = document.querySelector<HTMLElement>('[data-kb-articles-tab]')
      if (!el) {
        // The tab might not be mounted yet — retry briefly on rAF.
        if (attempts < 30) {
          attempts += 1
          rafId = requestAnimationFrame(measure)
        }
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    measure()

    const onResizeOrScroll = () => measure()
    window.addEventListener('resize', onResizeOrScroll)
    window.addEventListener('scroll', onResizeOrScroll, true)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResizeOrScroll)
      window.removeEventListener('scroll', onResizeOrScroll, true)
    }
  }, [isVisible])

  if (!mounted || !isVisible || !rect) return null

  // Position the arrow above the center of the tab, pointing down at it.
  const ARROW_SIZE = 28
  const GAP = 6
  const top = rect.top - ARROW_SIZE - GAP
  const left = rect.left + rect.width / 2 - ARROW_SIZE / 2

  return createPortal(
    <div
      data-slot='kb-articles-tab-arrow'
      className='pointer-events-none fixed z-[60] motion-safe:animate-bounce motion-reduce:animate-none'
      style={{ top, left, width: ARROW_SIZE, height: ARROW_SIZE }}
      aria-hidden>
      <div className='flex size-full items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg'>
        <ArrowDown className='size-4' />
      </div>
    </div>,
    document.body
  )
}
