// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-mapping-page.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { useAccess } from '~/providers/capabilities-provider'
import { MappingList } from '../settings/mapping-list'

/** The role map, as Settings → Accounts shows it; each change saves as it is made. */
export function ConnectAndGoMappingPage() {
  const { can } = useAccess()
  return (
    <div className='p-4'>
      <MappingList canControl={can(PermissionKey.ledgerControl)} className='p-0 sm:p-0' />
    </div>
  )
}
