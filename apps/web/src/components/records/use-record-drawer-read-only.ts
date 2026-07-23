// apps/web/src/components/records/use-record-drawer-read-only.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * Single source of truth for the record drawer's restricted (read-only) mode.
 *
 * A member is read-only in the drawer when they cannot edit CRM records — i.e.
 * a field ("worker") seat that has `records.viewLinked` but not `records.edit`
 * (the worker ceiling zeroes the `records` area). Full members — anyone with
 * `records.edit` — get `false`, so the drawer stays exactly as before (§11.4,
 * §2.K). Compute once near the drawer root and thread the boolean down; never
 * call `useAccess()` in leaf drawer components.
 */
export function useRecordDrawerReadOnly(): boolean {
  const { can } = useAccess()
  return !can(PermissionKey.recordsEdit)
}
