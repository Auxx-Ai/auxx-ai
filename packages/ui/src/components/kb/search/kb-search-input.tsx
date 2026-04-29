// packages/ui/src/components/kb/search/kb-search-input.tsx
'use client'

import Link from 'next/link'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { KBSearchDoc } from './build-search-index'
import styles from './kb-search-input.module.css'

interface KBSearchInputProps {
  /** Path to the search index JSON, e.g. `/<orgSlug>/<kbSlug>/_search.json`. */
  searchOrigin: string
  /** Base path for article links, e.g. `/<orgSlug>/<kbSlug>`. */
  basePath: string
  placeholder?: string
}

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

export function KBSearchInput({
  searchOrigin,
  basePath,
  placeholder = 'Search articles…',
}: KBSearchInputProps) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [mini, setMini] = useState<MiniSearchLike | null>(null)
  const [results, setResults] = useState<MiniSearchHit[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [{ default: MiniSearch }, res] = await Promise.all([
          import('minisearch'),
          fetch(searchOrigin, { credentials: 'omit' }),
        ])
        if (!res.ok) return
        const docs = (await res.json()) as KBSearchDoc[]
        if (cancelled) return
        const instance = new MiniSearch({
          fields: ['title', 'headings', 'body', 'description'],
          storeFields: ['title', 'path', 'description'],
          searchOptions: { boost: { title: 3, headings: 2 }, fuzzy: 0.2, prefix: true },
        })
        instance.addAll(docs)
        setMini(instance as unknown as MiniSearchLike)
      } catch {
        // Silently degrade: search becomes a no-op if the index can't load.
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [searchOrigin])

  useEffect(() => {
    if (!mini || !deferred.trim()) {
      setResults([])
      return
    }
    setResults(mini.search(deferred).slice(0, 8))
  }, [mini, deferred])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <input
        type='search'
        className={styles.input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label='Search articles'
      />
      {open && query.trim() ? (
        <div className={styles.results} role='listbox'>
          {results.length === 0 ? (
            <div className={styles.empty}>No matches</div>
          ) : (
            results.map((hit) => (
              <Link
                key={hit.id}
                href={`${basePath}/${hit.path}`}
                className={styles.result}
                prefetch={false}
                onClick={() => setOpen(false)}>
                <div className={styles.resultTitle}>{hit.title}</div>
                {hit.description ? (
                  <div className={styles.resultDescription}>{hit.description}</div>
                ) : null}
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
