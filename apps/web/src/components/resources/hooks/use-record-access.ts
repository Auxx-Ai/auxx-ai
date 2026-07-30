// apps/web/src/components/resources/hooks/use-record-access.ts
'use client'

import type { Rung } from '@auxx/database/enums'
import { canEditRecordAtRung, satisfiesRung } from '@auxx/lib/permissions/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useCallback } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { useRecordStore } from '../store/record-store'
import { useNormalizedRecordId } from '../utils/normalize-record-id'

/**
 * **The per-ROW record affordance gate** (plan v3/03 §5.2 / §6.2).
 *
 * `canEditEntity(def)` answers *"may I edit records of this definition"* — the
 * right question for New / import / export-all / bulk / view management, and the
 * WRONG one for a specific row. Since P5 a member can hold `edit` or `admin` on
 * one row of a definition they cannot otherwise see, and can equally hold only
 * `read` on a row of a def whose other rows they edit freely. Deciding edit mode
 * once per table gets both cases wrong, in opposite directions.
 *
 * The answer is the server-resolved `_access` stamp riding the row itself
 * (`RecordMeta._access`, from `record.getByIds`), read through the SAME verb
 * functions the server applies (`canEditRecordAtRung`, `canDeleteRecordAtRung`),
 * so the affordance and the mutation cannot drift.
 */
export interface RecordRowAccess {
  /**
   * The row-effective rung. Never `undefined`: an unstamped row falls back to
   * the member's DEF rung, which is precisely what the server's fold
   * (`foldRecordAccess(defRung, null)`) computes for a row with no grants on it.
   * The fallback can therefore only under-report for a grant-only member, and
   * only for the instant before the row lands in the store.
   */
  access: Rung
  /** May this row be edited / archived / restored? The `edit` floor at row level. */
  canEdit: boolean
  /** May this row be deleted or merged away? `edit` floor + (`records.delete` OR `admin`). */
  canDelete: boolean
  /**
   * May this row's SHARING be managed? Mirrors the server's
   * `assertCanManageRecordSharing`, which is `_access >= admin` — and `_access`
   * has already folded the def level in, so no separate def branch is needed
   * (base record rungs cap at `edit`, so `admin` can only come from an explicit
   * grant or OWNER).
   */
  canShare: boolean
}

/**
 * Resolve one row's affordances from its `_access` stamp.
 *
 * Takes a `RecordId` and reads the store directly rather than accepting a row
 * object, so a leaf can ask without the row being threaded through every
 * intermediate component. It does NOT request the record — callers already hold
 * it (drawer, table row); an unfetched row resolves through the def fallback.
 */
export function useRecordAccess(recordId: RecordId | null | undefined): RecordRowAccess {
  const normalized = useNormalizedRecordId(recordId)
  const parsed = normalized ? parseRecordId(normalized) : null
  return useRecordAccessFor(parsed?.entityDefinitionId, parsed?.entityInstanceId)
}

/**
 * {@link useRecordAccess} for callers that hold the two halves separately —
 * notably the drawer, whose instance id resolves a beat after its def id.
 *
 * Passing a def with NO instance is a supported state and resolves to the
 * member's def rung, so the surface keeps the pre-P5 answer for that instant
 * rather than flashing read-only.
 */
export function useRecordAccessFor(
  entityDefinitionId: string | null | undefined,
  entityInstanceId: string | null | undefined
): RecordRowAccess {
  const defId = entityDefinitionId ?? ''
  const instId = entityInstanceId ?? ''
  const stamp = useRecordStore(
    useCallback(
      (state) => (instId && defId ? state.records[defId]?.get(instId)?._access : undefined),
      [defId, instId]
    )
  )
  return useRecordAccessAt(entityDefinitionId ?? undefined, stamp)
}

/**
 * The same resolution from an ALREADY-HELD stamp — for surfaces that render a
 * list of rows they own (the records table), which must not open one store
 * subscription per row.
 */
export function useRecordAccessAt(
  entityDefinitionId: string | undefined,
  stamp: Rung | undefined
): RecordRowAccess {
  const { recordDefRung, canDeleteRecordAt } = useAccess()
  const access: Rung = entityDefinitionId
    ? (stamp ?? recordDefRung(entityDefinitionId) ?? 'none')
    : 'none'
  return {
    access,
    canEdit: canEditRecordAtRung(access),
    canDelete: canDeleteRecordAt(access),
    canShare: satisfiesRung(access, 'admin'),
  }
}
