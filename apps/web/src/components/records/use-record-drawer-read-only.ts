// apps/web/src/components/records/use-record-drawer-read-only.ts
'use client'

import { useAccess } from '~/providers/capabilities-provider'

/**
 * Single source of truth for the record drawer's restricted (read-only) mode.
 *
 * A member is read-only in the drawer when they cannot edit the def's records —
 * `!canEditEntity(entityDefinitionId)` (Layer 2 × Layer 3, most-specific-wins).
 * This covers a field ("worker") seat (records ceiling None) AND a member who is
 * a Read-only grantee on a restricted def, while raising a member granted Edit on
 * a def they'd otherwise lack. Full members are unaffected. Compute once near the
 * drawer root and thread the boolean down; never call `useAccess()` in leaves.
 *
 * @param entityDefinitionId The def whose records the drawer edits. When
 *   `undefined` (def still resolving) the drawer stays editable — the server
 *   remains the source of truth and rejects a disallowed write.
 */
export function useRecordDrawerReadOnly(entityDefinitionId: string | undefined): boolean {
  const { canEditEntity } = useAccess()
  return entityDefinitionId ? !canEditEntity(entityDefinitionId) : false
}
