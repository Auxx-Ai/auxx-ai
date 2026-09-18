// apps/web/src/components/accounting/ui/banking/payouts/record-chip-link.tsx

'use client'

// The order or invoice a matched receipt is applied to, as a record link —
// `ledger-source-link.tsx`'s resolution (`useResourceProperty` → `useRecordLink`)
// on a badge instead of a mono id.

import { Badge } from '@auxx/ui/components/badge'
import Link from 'next/link'
import { toRecordId, useRecordLink, useResourceProperty } from '~/components/resources'

export interface LinkedDocument {
  /** An entity slug (`order`, `invoice`, `payout`); anything unresolvable renders as plain text. */
  kind: string
  instanceId: string
  displayName: string | null
}

export function RecordChipLink({ document }: { document: LinkedDocument }) {
  const entityDefId = useResourceProperty(document.kind, 'id')
  const href = useRecordLink(entityDefId ? toRecordId(entityDefId, document.instanceId) : null)
  const label = document.displayName ?? `${document.kind} ${document.instanceId.slice(0, 8)}`

  if (!href) {
    return (
      <Badge variant='outline' size='xs'>
        {label}
      </Badge>
    )
  }
  return (
    <Link href={href}>
      <Badge variant='outline' size='xs' className='hover:underline'>
        {label}
      </Badge>
    </Link>
  )
}
