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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // Compared by serialized value, NOT object identity — callers pass an inline
  // object literal (a fresh ref every render), so an identity check would loop.
  const serialized = JSON.stringify(serverValue)

  // `isDirty` is DERIVED — the draft genuinely differs from the saved value. A
  // manual flag would stay set after the user edits a field and reverts it; this
  // clears the moment the draft matches the server again.
  const isDirty = JSON.stringify(draft) !== serialized

  // Re-seed from the server when it changes (switching connectors/streams, an
  // external update), unless the user has an in-progress edit. `touched` (not
  // `isDirty`) gates this: a server move shouldn't read as a user edit, and a
  // revert-to-original clears it so later server changes still land.
  const touched = useRef(false)
  const lastSeeded = useRef(serialized)
  useEffect(() => {
    if (serialized === lastSeeded.current || touched.current) return
    lastSeeded.current = serialized
    setDraft(serverValue)
  }, [serialized, serverValue])

  const commit = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    const snapshot = JSON.stringify(draft)
    await onCommitRef.current(draft)
    touched.current = false
    lastSeeded.current = snapshot
  }, [draft])

  const set = useCallback(
    (next: T) => {
      setDraft(next)
      touched.current = JSON.stringify(next) !== serialized
      if (mode === 'auto') {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void commit(), debounceMs)
      }
    },
    [mode, debounceMs, commit, serialized]
  )

  return { value: draft, set, commit, isDirty }
}
