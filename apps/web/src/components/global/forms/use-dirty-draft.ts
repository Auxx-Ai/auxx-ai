// apps/web/src/components/global/forms/use-dirty-draft.ts
'use client'

import { useEffect, useRef, useState } from 'react'

export interface DirtyDraft<T> {
  /** The working copy the form edits. */
  draft: T
  /** Shallow-merge a partial into the draft. */
  patch: (partial: Partial<T>) => void
  /** Full-replace the draft. */
  setDraft: (next: T) => void
  /** True while the draft diverges (by value) from the server value. */
  dirty: boolean
  /** Run `onSave(draft)`. */
  save: () => void
  /** Throw away edits and reseed from the server value. */
  discard: () => void
}

/**
 * The one dirty-draft mechanism every settings form shares (10-settings-forms-unification.md):
 * a local working copy of some server value driving a {@link FormSaveBar} / dialog footer.
 *
 * `dirty` is **computed by value** (`draft` vs `server`), not a sticky flag — so editing a field
 * and then reverting it to its original value clears `dirty` again. The generic `T` fits every
 * surface: a `Record<SettingKey, value>` map (Documents / Invoicing), a typed worker object, a
 * `WeeklyHoursDraft`.
 *
 * Callers pass the freshly-derived `server` value each render; the hook adopts a *changed* server
 * value into the draft only while the user hasn't diverged and no save is in flight — so a
 * background refetch never clobbers edits and a pending mutation never reverts the draft.
 *
 * ```tsx
 * const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
 *   onSave: (next) => batchUpdate(diff(next, server)),
 *   isSaving,
 * })
 * ```
 */
export function useDirtyDraft<T extends object>(
  server: T,
  opts: { onSave: (draft: T) => void; isSaving?: boolean }
): DirtyDraft<T> {
  const { onSave, isSaving = false } = opts
  const serverSig = JSON.stringify(server)
  const [draft, setDraftState] = useState<T>(server)
  const dirty = JSON.stringify(draft) !== serverSig

  // The server signature the draft was last seeded from — lets us tell a genuine server change
  // apart from the same value rebuilt each render, and detect whether the user has diverged.
  const baselineRef = useRef(serverSig)

  useEffect(() => {
    // The `serverSig === baselineRef` guard makes the extra `server` dep a no-op when the value is
    // unchanged (rebuilt each render) — it only proceeds on a genuine server change.
    if (serverSig === baselineRef.current || isSaving) return
    // Server changed under us: adopt it only if the user hasn't edited away from the previous
    // server value; otherwise keep their edits (dirty now compares against the new server).
    if (JSON.stringify(draft) === baselineRef.current) setDraftState(server)
    baselineRef.current = serverSig
  }, [serverSig, isSaving, server, draft])

  const patch = (partial: Partial<T>) => {
    setDraftState((prev) => ({ ...prev, ...partial }) as T)
  }

  const save = () => onSave(draft)

  const discard = () => setDraftState(server)

  return { draft, patch, setDraft: setDraftState, dirty, save, discard }
}
