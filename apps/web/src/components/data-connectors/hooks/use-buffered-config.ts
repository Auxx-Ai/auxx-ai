// apps/web/src/components/data-connectors/hooks/use-buffered-config.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type CommitMode = 'manual' | 'auto'

/**
 * Buffered draft + commit. `manual` mode commits only when `commit()` is called
 * (a Save button). `auto` mode debounces a commit after each `set()`. Flips
 * between the two with a single prop — components bind `value`/`set`/`commit`/
 * `isDirty` identically in both modes, so turning a deliberate Save form into
 * autosave later is a one-line change here, not a component rewrite.
 *
 * See plans/data-connectors/claude/06-frontend-update-handling.md §6.
 */
export function useBufferedConfig<T>(
  serverValue: T,
  onCommit: (draft: T) => unknown,
  opts: { mode?: CommitMode; debounceMs?: number } = {}
) {
  const { mode = 'manual', debounceMs = 800 } = opts
  const [draft, setDraft] = useState(serverValue)
  const [isDirty, setDirty] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // Re-seed from the server when not mid-edit (e.g. switching connectors/streams).
  // Compared by serialized value, NOT object identity — callers pass an inline
  // object literal (a fresh ref every render), so an identity check would loop.
  const serialized = JSON.stringify(serverValue)
  const lastSeeded = useRef(serialized)
  useEffect(() => {
    if (isDirty || lastSeeded.current === serialized) return
    lastSeeded.current = serialized
    setDraft(serverValue)
  }, [serialized, isDirty, serverValue])

  const commit = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    setDirty(false)
    await onCommitRef.current(draft)
  }, [draft])

  const set = useCallback(
    (next: T) => {
      setDraft(next)
      setDirty(true)
      if (mode === 'auto') {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void commit(), debounceMs)
      }
    },
    [mode, debounceMs, commit]
  )

  return { value: draft, set, commit, isDirty }
}
