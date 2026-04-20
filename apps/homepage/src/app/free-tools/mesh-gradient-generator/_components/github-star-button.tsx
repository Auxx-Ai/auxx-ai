// apps/homepage/src/app/free-tools/mesh-gradient-generator/_components/github-star-button.tsx
'use client'

import { Github, Star } from 'lucide-react'
import { useEffect, useState } from 'react'

const REPO = 'Auxx-Ai/auxx-ai'
const REPO_URL = `https://github.com/${REPO}`
const API_URL = `https://api.github.com/repos/${REPO}`
const CACHE_KEY = `gh-stars:${REPO}`
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

type Cached = { count: number; at: number }

function readCache(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    if (Date.now() - parsed.at < CACHE_TTL_MS) return parsed.count
  } catch {
    // ignore
  }
  return null
}

function writeCache(count: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ count, at: Date.now() }))
  } catch {
    // ignore
  }
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

export function GithubStarButton() {
  const [count, setCount] = useState<number | null>(() => readCache())

  useEffect(() => {
    if (count !== null) return
    let cancelled = false
    fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (cancelled || !data?.stargazers_count) return
        setCount(data.stargazers_count)
        writeCache(data.stargazers_count)
      })
      .catch(() => {
        // Silently ignore — fall back to the "Star" button without a count
      })
    return () => {
      cancelled = true
    }
  }, [count])

  return (
    <a
      href={REPO_URL}
      target='_blank'
      rel='noopener noreferrer'
      className='inline-flex items-center gap-0 overflow-hidden rounded-md border border-border bg-card text-sm font-medium shadow-sm transition-colors hover:border-foreground/40'>
      <span className='inline-flex items-center gap-1.5 border-r border-border bg-background px-3 py-1.5 text-muted-foreground'>
        <Github className='size-3.5' />
        Star on GitHub
      </span>
      <span className='inline-flex items-center gap-1 px-3 py-1.5'>
        <Star className='size-3.5 fill-yellow-500 text-yellow-500' />
        <span className='font-mono text-xs'>{count !== null ? formatCount(count) : '—'}</span>
      </span>
    </a>
  )
}
