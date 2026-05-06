// packages/ui/src/components/kb/article/kb-toc.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Text } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KBHeading } from './extract-headings'

interface KBTableOfContentsProps {
  headings: KBHeading[]
  /** Hide the inline "On this page" heading (used inside drawers that already provide a title). */
  hideHeading?: boolean
  /** Called when a heading link is clicked — used by the drawer to auto-close. */
  onLinkClick?: () => void
  /** When set, the "On this page" header becomes a button that calls this. */
  onCollapse?: () => void
}

export function KBTableOfContents({
  headings,
  hideHeading,
  onLinkClick,
  onCollapse,
}: KBTableOfContentsProps) {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (headings.length === 0) return
    const topPx = computeStickyOffset(navRef.current)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActive(visible[0].target.id)
      },
      { rootMargin: `-${topPx}px 0px -70% 0px` }
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav ref={navRef} data-slot='kb-toc' aria-label='Table of contents' className='text-sm'>
      {hideHeading ? null : onCollapse ? (
        <button
          type='button'
          onClick={onCollapse}
          aria-label='Hide table of contents'
          className='mb-3 -ml-1 flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left font-medium text-[var(--kb-fg)] transition-colors hover:text-[var(--kb-fg)]/70'>
          <Text className='size-4 text-[var(--kb-fg)]/70' aria-hidden />
          On this page
        </button>
      ) : (
        <p className='mb-3 flex items-center gap-2 font-medium text-[var(--kb-fg)]'>
          <Text className='size-4 text-[var(--kb-fg)]/70' aria-hidden />
          On this page
        </p>
      )}
      <ul className='m-0 flex list-none flex-col border-l border-[var(--kb-border)] p-0'>
        {headings.map((h) => {
          const indent = Math.max(0, h.depth - 2) * 12
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                data-active={active === h.id}
                style={{ paddingLeft: `${indent + 12}px` }}
                onClick={onLinkClick}
                className={cn(
                  '-ml-px block border-l border-transparent py-1.5 pr-2 text-[var(--kb-fg)]/60 no-underline transition-colors',
                  'hover:text-[var(--kb-fg)]',
                  'data-[active=true]:border-[var(--kb-primary)] data-[active=true]:text-[var(--kb-primary)]'
                )}>
                {h.text}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Resolve the sticky-chrome height in px by reading the same CSS variables
 * the article's `scroll-margin-top` uses (`--kb-top-offset`, `--kb-header-h`,
 * `--kb-tabs-h`). Keeps the IntersectionObserver's "active heading" cutoff
 * aligned with where headings actually land after a click.
 */
function computeStickyOffset(scope: Element | null): number {
  if (typeof window === 'undefined') return 80
  const el = scope ?? document.documentElement
  const style = getComputedStyle(el)
  const px = (raw: string, fallback: number): number => {
    const v = raw.trim()
    if (!v) return fallback
    if (v.endsWith('px')) return Number.parseFloat(v) || fallback
    if (v.endsWith('rem')) {
      const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      return (Number.parseFloat(v) || 0) * root
    }
    return Number.parseFloat(v) || fallback
  }
  const top = px(style.getPropertyValue('--kb-top-offset'), 0)
  const header = px(style.getPropertyValue('--kb-header-h'), 56)
  const tabs = px(style.getPropertyValue('--kb-tabs-h'), 0)
  return top + header + tabs + 8
}
