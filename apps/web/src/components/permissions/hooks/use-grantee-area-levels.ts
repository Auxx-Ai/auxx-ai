// apps/web/src/components/permissions/hooks/use-grantee-area-levels.ts
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { useCallback, useMemo } from 'react'
import { type OverrideGranteeType, useGrantWrites } from './use-permission-grants'
import { type StagedSurface, useStagedEdits } from './use-staged-edits'

/**
 * Staged Layer-2 area levels for one override grantee — the group/member twin of
 * `useProfileEditor`'s draft, and the reason those two surfaces now commit the
 * same way.
 *
 * Both hosts of the override grid (the permissions page's Group/Member overrides
 * tab, and a member or team detail page's Access levels section) used to write
 * `permissions.grant` on every select change while the profile editor next door
 * drafted and saved from a `FormSaveBar`. Identical-looking controls, two commit
 * models. This stages instead, and the host flushes it.
 *
 * `persisted` is the grantee's stored sparse map — from `listGrants` on the
 * overrides tab, from `granteeAccess.own.areas` on a detail page. It stays the
 * caller's to supply because those are different queries over the same rows.
 *
 * The flush is ONE `permissions.grant` write of the whole resulting map (that is
 * the mutation's shape), so a failure keeps every staged area rather than a
 * partial set — there is no partial success to reflect.
 */
export function useGranteeAreaLevels(
  granteeType: OverrideGranteeType,
  granteeId: string,
  persisted: Partial<Record<Area, Level>>
): {
  /** `persisted` with the staged edits laid over it — what the grid renders. */
  values: Partial<Record<Area, Level>>
  /** Stage one area's level; `undefined` stages a fall-through to the baseline. */
  setLevel: (area: Area, level: Level | undefined) => void
} & StagedSurface {
  const { saveAsync, isSaving } = useGrantWrites()
  const { entries: stagedEntries, stage, discard, isDirty } = useStagedEdits<Level | 'inherit'>()

  const values = useMemo(() => {
    const next = { ...persisted }
    for (const [area, level] of stagedEntries) {
      // `'inherit'` DELETES the key — the area falls through to the member
      // baseline. An explicit `Level.None` is `0` and must never be conflated
      // with absent: it is the only way an override says "no access".
      if (level === 'inherit') delete next[area as Area]
      else next[area as Area] = level
    }
    return next
  }, [persisted, stagedEntries])

  const setLevel = useCallback(
    (area: Area, level: Level | undefined) => {
      stage(area, level ?? 'inherit', persisted[area] ?? 'inherit')
    },
    [stage, persisted]
  )

  const save = useCallback(async () => {
    if (stagedEntries.length === 0) return true
    try {
      await saveAsync(granteeType, granteeId, values)
    } catch {
      // `useGrantWrites` already reported it; keep every edit staged so the bar
      // stays up and Save retries the same map.
      return false
    }
    discard()
    return true
  }, [stagedEntries, saveAsync, granteeType, granteeId, values, discard])

  return { values, setLevel, isDirty, isSaving, save, discard }
}
