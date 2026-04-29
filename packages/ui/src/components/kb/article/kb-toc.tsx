// packages/ui/src/components/kb/article/kb-toc.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useState } from 'react'
import type { KBHeading } from './extract-headings'

interface KBTableOfContentsProps {
  headings: KBHeading[]
}

export function KBTableOfContents({ headings }: KBTableOfContentsProps) {
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
    <aside className='mx-auto mb-8 w-full max-w-3xl rounded-[var(--kb-radius)] border border-[var(--kb-border)] bg-[var(--kb-muted)]/40 px-5 py-4 text-sm'>
      <p className='mb-2 text-xs font-medium uppercase tracking-wider text-[var(--kb-fg)]/60'>
        On this page
      </p>
      <ul className='m-0 list-none space-y-1 p-0'>
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: `${(h.depth - 2) * 12}px` }}>
            <a
              href={`#${h.id}`}
              data-active={active === h.id}
              className={cn(
                'block py-1 text-[var(--kb-fg)]/70 no-underline transition-colors',
                'hover:text-[var(--kb-fg)]',
                'data-[active=true]:font-medium data-[active=true]:text-[var(--kb-primary)]'
              )}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
