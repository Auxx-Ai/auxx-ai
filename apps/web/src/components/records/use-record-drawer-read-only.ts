// apps/web/src/components/records/use-record-drawer-read-only.ts
'use client'

import { useRecordAccessFor } from '~/components/resources/hooks'

/**
 * Single source of truth for the record drawer's restricted (read-only) mode.
 *
 * **PER ROW since plan v3/03 P5, not per definition.** It used to ask
 * `!canEditEntity(entityDefinitionId)` — a def-level question — which made a
 * per-record `edit` grant inert in the UI exactly as it was inert on the server:
 * the member could open the row and every field was read-only. It now reads the
 * row's own `_access` stamp through {@link useRecordAccess}, so:
 *
 *  - a row shared at `edit`/`admin` on a def the member cannot otherwise see is
 *    EDITABLE, and
 *  - a row shared at `read` on such a def is not, even though other rows of that
 *    def may be.
 *
 * A field ("worker") seat still resolves read-only — the seat ceiling is applied
 * when the stamp is built, so it can never be raised by a share.
 *
 * An unstamped row falls back to the member's def rung, which is what the pre-P5
 * behaviour was; see `useRecordAccess` for why that fallback is the honest one.
 * Compute once near the drawer root and thread the boolean down; never call
 * `useAccess()` in leaves.
 */
export function useRecordDrawerReadOnly(
  entityDefinitionId: string | undefined,
  entityInstanceId?: string | undefined
): boolean {
  // A def with no instance yet resolves to the def rung, so the window before
  // the row lands keeps the old def-level answer instead of flashing read-only.
  const { canEdit } = useRecordAccessFor(entityDefinitionId, entityInstanceId)
  return entityDefinitionId ? !canEdit : false
}
