// apps/web/src/components/pickers/record-picker/use-prune-deleted-selections.ts

'use client'

import type { RecordId, RecordPickerItem } from '@auxx/lib/resources/client'
import { useEffect, useMemo, useRef } from 'react'
import { api } from '~/trpc/react'

/**
 * The ids whose hydration came back **explicitly not-found** — the only ids that
 * are even worth asking the server about.
 *
 * 🛑 **`null` and `undefined` are different answers and must stay different.**
 * `relationship-store.ts` documents the three states: an item (found), `null`
 * (the batch returned and this id was not in it), `undefined` (not loaded yet).
 * The picker's `hydratedMap` collapses all three by admitting only truthy items,
 * which is the bug this exists to fix — but a candidate test keyed on falsiness
 * rather than on `null` would nominate **every** relation on first paint, before
 * hydration returns, and the caller would then save that. The `=== null` is
 * load-bearing.
 *
 * A candidate is not a verdict: `null` also covers "this viewer cannot see it"
 * (mail-lens ids, a def the viewer's record scope excludes, a row the visibility
 * predicate hid, an instance-access row). Only `record.checkMissingTargets`,
 * which resolves the target's own backing table, may decide.
 */
export function selectNotFoundCandidates(
  recordIds: RecordId[],
  hydratedItems: (RecordPickerItem | null | undefined)[]
): RecordId[] {
  const candidates: RecordId[] = []
  for (let index = 0; index < recordIds.length; index++) {
    if (hydratedItems[index] === null) {
      const recordId = recordIds[index]
      if (recordId) candidates.push(recordId)
    }
  }
  return candidates
}

/** Options for {@link usePruneDeletedSelections}. */
export interface PruneDeletedSelectionsOptions {
  /** The ids rendered in the Selected section, in hydration order. */
  recordIds: RecordId[]
  /** Hydration results, positionally aligned with `recordIds`. */
  hydratedItems: (RecordPickerItem | null | undefined)[]
  /** The picker's current selection. */
  value: RecordId[]
  /** Called with the selection minus every confirmed-deleted id. */
  onChange: (selected: RecordId[]) => void
  /** Skip entirely when the picker cannot be edited. */
  enabled: boolean
}

/**
 * Drop references to **hard-deleted** records from the picker's selection.
 *
 * Without this, a dangling id is invisible (it has no hydrated item, so the
 * Selected section never renders it and the user cannot deselect it) yet stays
 * in `value` — and `relationship-input-field.tsx` commits the whole id list on
 * close, re-saving the broken reference on every subsequent edit. Pruning makes
 * ordinary editing self-healing instead.
 *
 * The two-step shape is the safety property: hydration nominates, the server
 * decides. Anything the existence check will not judge — threads, articles, any
 * def it cannot resolve to `EntityInstance` — is kept.
 */
export function usePruneDeletedSelections({
  recordIds,
  hydratedItems,
  value,
  onChange,
  enabled,
}: PruneDeletedSelectionsOptions): void {
  // Ids already sent to the existence check, so a verdict of "still there" is
  // not re-asked on every render.
  const judged = useRef<Set<RecordId>>(new Set())

  const candidates = useMemo(
    () => selectNotFoundCandidates(recordIds, hydratedItems),
    [recordIds, hydratedItems]
  )

  const pending = useMemo(
    () => candidates.filter((recordId) => !judged.current.has(recordId)),
    [candidates]
  )

  // Stable query input: react-query keys on deep equality, but a fresh array
  // every render still churns the effect below.
  const pendingKey = pending.join('|')
  const items = useMemo(() => (pendingKey ? pendingKey.split('|') : []), [pendingKey])

  const { data } = api.record.checkMissingTargets.useQuery(
    { items },
    { enabled: enabled && items.length > 0, staleTime: 60_000 }
  )

  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!data) return
    for (const recordId of items) judged.current.add(recordId as RecordId)
    if (data.missing.length === 0) return

    const missing = new Set<string>(data.missing)
    const next = valueRef.current.filter((recordId) => !missing.has(recordId))
    if (next.length !== valueRef.current.length) onChangeRef.current(next)
  }, [data, items])
}
