// apps/web/src/components/kopilot/ui/blocks/use-stream-safe-ids.ts

'use client'

import { useRef } from 'react'

/**
 * Filters a streaming id list so the trailing element is withheld while the
 * fence's JSON currently ends inside an unterminated string — the only state
 * in which that element can be a half-streamed id. Every earlier element was
 * followed by a delimiter, so it is provably complete and renders immediately.
 *
 * Ids are ratcheted: once an id has rendered during a frame where all strings
 * were closed, it stays visible even when a later field's string (e.g. a
 * snapshot displayName) is mid-stream and flips `lastValueTruncated` back on.
 * Completeness is judged purely by JSON structure — id shape is never
 * inspected, so alias / system-attribute prefixes are unaffected.
 */
export function useStreamSafeIds(ids: string[], lastValueTruncated: boolean | undefined): string[] {
  const shownRef = useRef<Set<string>>(new Set())
  const safe = lastValueTruncated
    ? ids.filter((id, i) => i < ids.length - 1 || shownRef.current.has(id))
    : ids
  for (const id of safe) shownRef.current.add(id)
  return safe
}
