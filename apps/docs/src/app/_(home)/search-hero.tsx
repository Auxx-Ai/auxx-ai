// apps/docs/src/app/_(home)/search-hero.tsx
'use client'

import { useSearchContext } from 'fumadocs-ui/provider'
import { SearchIcon } from 'lucide-react'

export function SearchHero() {
  const { setOpenSearch } = useSearchContext()

  return (
    <div className='flex flex-col items-center gap-6 px-4 py-16 text-center'>
      <h1 className='text-4xl font-bold tracking-tight sm:text-5xl'>Hi, how can we help?</h1>
      <button
        type='button'
        onClick={() => setOpenSearch(true)}
        className='bg-fd-secondary/50 text-fd-muted-foreground hover:bg-fd-secondary flex w-full max-w-lg items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors'>
        <SearchIcon className='size-5 shrink-0' />
        <span className='flex-1'>Search documentation...</span>
        <kbd className='bg-fd-background hidden rounded-md border px-2 py-0.5 text-xs font-mono sm:inline-block'>
          ⌘K
        </kbd>
      </button>
    </div>
  )
}
