// packages/ui/src/components/kb/article/kb-toc.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Text } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KBHeading } from './extract-headings'

interface KBTableOfContentsProps {
  headings: KBHeading[]
  /** Hide the inline "On this page" heading (used inside drawers that already provide a title). */
  hideHeading?: boolean
  /** Called when a heading link is clicked — used by the drawer to auto-close. */
  onLinkClick?: () => void
}

export function KBTableOfContents({ headings, hideHeading, onLinkClick }: KBTableOfContentsProps) {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null)

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -70% 0px' }
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav data-slot='kb-toc' aria-label='Table of contents' className='text-sm'>
      {hideHeading ? null : (
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
