// packages/ui/src/components/kb/search/kb-search-input.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Search } from 'lucide-react'
import { useKBLayoutContextOptional } from '../layout/kb-layout-context'

interface KBSearchInputProps {
  /** Path to the search index JSON, e.g. `/<orgSlug>/<kbSlug>/_search.json`. */
  searchOrigin: string
  /** Base path for article links, e.g. `/<orgSlug>/<kbSlug>`. */
  basePath: string
  placeholder?: string
  /** `pill` (default) — full-width fumadocs-style trigger. `icon` — square icon button. */
  variant?: 'pill' | 'icon'
  className?: string
}

export function KBSearchInput({
  placeholder = 'Search articles…',
  variant = 'pill',
  className,
}: KBSearchInputProps) {
  const ctx = useKBLayoutContextOptional()
  const onClick = () => ctx?.setSearchOpen(true)

  if (variant === 'icon') {
    return (
      <button
        type='button'
        onClick={onClick}
        aria-label='Search'
        className={cn(
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--kb-radius)] border-0 bg-transparent text-[var(--kb-fg)] transition-colors hover:bg-[var(--kb-muted)]',
          className
        )}>
        <Search className='size-4' />
      </button>
    )
  }

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-[var(--kb-radius)] border border-[var(--kb-border)] bg-[var(--kb-muted)] px-3 py-2 text-left text-sm text-[var(--kb-fg)]/60 transition-colors hover:border-[var(--kb-primary)] hover:text-[var(--kb-fg)]/80',
        className
      )}>
      <Search className='size-4 shrink-0' />
      <span className='flex-1'>{placeholder}</span>
      <kbd className='hidden items-center gap-1 rounded border border-[var(--kb-border)] bg-[var(--kb-bg)] px-1.5 py-0.5 font-mono text-xs @kb-md:flex'>
        <span>⌘</span>
        <span>K</span>
      </kbd>
    </button>
  )
}
