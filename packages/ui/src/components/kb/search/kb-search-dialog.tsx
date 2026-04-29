// packages/ui/src/components/kb/search/kb-search-dialog.tsx
'use client'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { useRouter } from 'next/navigation'
import { useDeferredValue, useEffect, useState } from 'react'
import type { KBSearchDoc } from './build-search-index'

interface MiniSearchHit {
  id: string
  score: number
  title: string
  path: string
  description?: string
}

interface MiniSearchLike {
  search: (query: string) => MiniSearchHit[]
}

interface KBSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchOrigin: string
  basePath: string
}

export function KBSearchDialog({
  open,
  onOpenChange,
  searchOrigin,
  basePath,
}: KBSearchDialogProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [mini, setMini] = useState<MiniSearchLike | null>(null)
  const [results, setResults] = useState<MiniSearchHit[]>([])

  useEffect(() => {
    if (!open || mini) return
    let cancelled = false
    async function load() {
      try {
        const [{ default: MiniSearch }, res] = await Promise.all([
          import('minisearch'),
          fetch(searchOrigin, { credentials: 'omit' }),
        ])
        if (!res.ok || cancelled) return
        const docs = (await res.json()) as KBSearchDoc[]
        const instance = new MiniSearch({
          fields: ['title', 'headings', 'body', 'description'],
          storeFields: ['title', 'path', 'description'],
          searchOptions: { boost: { title: 3, headings: 2 }, fuzzy: 0.2, prefix: true },
        })
        instance.addAll(docs)
        if (!cancelled) setMini(instance as unknown as MiniSearchLike)
      } catch {
        /* swallow */
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, mini, searchOrigin])

  useEffect(() => {
    if (!mini || !deferred.trim()) {
      setResults([])
      return
    }
    setResults(mini.search(deferred).slice(0, 12))
  }, [mini, deferred])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder='Search articles…'
        value={query}
        onValueChange={setQuery}
        loading={!mini && open}
      />
      <CommandList>
        <CommandEmpty>{query.trim() ? 'No matches.' : 'Type to search…'}</CommandEmpty>
        {results.length > 0 ? (
          <CommandGroup heading='Articles'>
            {results.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`${hit.title} ${hit.path}`}
                onSelect={() => {
                  router.push(`${basePath}/${hit.path}`)
                  onOpenChange(false)
                }}>
                <div className='flex flex-col'>
                  <span className='font-medium'>{hit.title}</span>
                  {hit.description ? (
                    <span className='text-muted-foreground text-xs'>{hit.description}</span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
