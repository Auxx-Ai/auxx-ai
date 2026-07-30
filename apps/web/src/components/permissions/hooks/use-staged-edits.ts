// apps/web/src/components/permissions/hooks/use-staged-edits.ts
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { useCallback, useMemo, useState } from 'react'

/**
 * What every access picker on the permissions surfaces writes: an explicit
 * permission, or the fall-through sentinel that DELETES the row.
 *
 * `'inherit'` is a string rather than `undefined` on purpose — staged edits have
 * to distinguish "this row is staged back to Inherit" from "this row has nothing
 * staged", and `undefined` cannot say both.
 */
export type AccessChoice = ResourcePermission | 'inherit'

/**
 * A surface that stages its edits locally and flushes them from ONE Save button.
 *
 * Implemented by every hook behind the permissions page's grids, so a host that
 * renders several of them can fold them into a single `FormSaveBar` through
 * {@link mergeStaged} without knowing what any of them writes.
 */
export interface StagedSurface {
  isDirty: boolean
  isSaving: boolean
  /** Flush every staged edit. Resolves `false` when at least one write failed. */
  save: () => Promise<boolean>
  discard: () => void
}

/**
 * A staged map of row edits — `rowKey -> next choice` — held locally until the
 * host's `FormSaveBar` flushes them.
 *
 * This is the permissions page's answer to the inconsistency the profile editor
 * exposed: a profile's area levels were drafted and saved in one transactional
 * mutation, while every neighbouring grid (workspace defaults, group and member
 * overrides, and even the profile editor's own nested def/instance rows) fired a
 * mutation per select change. Same-looking controls, two different commit
 * models. Everything now stages.
 *
 * Deliberately NOT a general form library: rows are independent writes against
 * independent `ResourceAccess` rows, so there is nothing to validate across them
 * and the flush is a loop, not a payload.
 */
export function useStagedEdits<V>() {
  const [edits, setEdits] = useState<Record<string, V>>({})

  /**
   * Stage one row's next value against what the server currently holds.
   *
   * Staging a row back to its persisted value DROPS the entry rather than
   * queueing a no-op write — which is also what makes the Save bar disappear
   * when an edit is undone by hand rather than through Discard.
   */
  const stage = useCallback((key: string, next: V, persisted: V) => {
    setEdits((prev) => {
      if (Object.is(next, persisted)) {
        if (!(key in prev)) return prev
        const { [key]: _dropped, ...rest } = prev
        return rest
      }
      if (key in prev && Object.is(prev[key], next)) return prev
      return { ...prev, [key]: next }
    })
  }, [])

  const discard = useCallback(() => setEdits({}), [])

  /** Keep only these edits — how a flush retains the rows whose write failed. */
  const replace = useCallback((remaining: Record<string, V>) => setEdits(remaining), [])

  const entries = useMemo(() => Object.entries(edits), [edits])

  return { edits, entries, stage, discard, replace, isDirty: entries.length > 0 }
}

/**
 * Fold several staged surfaces into the single Save/Discard pair a host renders.
 *
 * `save` runs them **sequentially**, not through `Promise.all`: every write lands
 * in the same `ResourceAccess` / `PermissionGrant` space and invalidates on
 * settle, so overlapping them would race a refetch against a later write.
 */
export function mergeStaged(surfaces: StagedSurface[]): StagedSurface {
  return {
    isDirty: surfaces.some((surface) => surface.isDirty),
    isSaving: surfaces.some((surface) => surface.isSaving),
    save: async () => {
      let ok = true
      for (const surface of surfaces) {
        if (!(await surface.save())) ok = false
      }
      return ok
    },
    discard: () => {
      for (const surface of surfaces) surface.discard()
    },
  }
}

/**
 * The staging key for a per-instance row: an instance id is only unique WITHIN
 * its resource type, and both per-instance surfaces render every type at once.
 */
export const stagedInstanceKey = (key: string, instanceId: string) => `${key}:${instanceId}`

/**
 * Split {@link stagedInstanceKey} back apart at flush time, where the write needs
 * a `RecordId`. Splits at the FIRST colon — resource keys carry none, instance
 * ids are cuids, and a `slice` is total where `split(':')[1]` would silently drop
 * anything past a second one.
 */
export function parseStagedInstanceKey<K extends string>(rowKey: string) {
  const at = rowKey.indexOf(':')
  return { key: rowKey.slice(0, at) as K, instanceId: rowKey.slice(at + 1) }
}
