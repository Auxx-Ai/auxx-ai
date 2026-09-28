// apps/web/src/app/(protected)/app/inventory/page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { redirect } from 'next/navigation'
import { useAccess } from '~/providers/capabilities-provider'

/** The module index lands on the action list, or on General for an admin without MRP. */
export default function InventoryIndexPage() {
  const { can } = useAccess()
  redirect(can(PermissionKey.mrpView) ? '/app/inventory/plan' : '/app/inventory/general')
}
