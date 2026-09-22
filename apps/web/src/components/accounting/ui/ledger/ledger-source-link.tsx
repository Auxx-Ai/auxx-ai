// apps/web/src/components/accounting/ui/ledger/ledger-source-link.tsx

'use client'

// One `GlPostingSource` row's identity, rendered as a link where `sourceKind`
// resolves to a live entity definition and plain text otherwise.

import Link from 'next/link'
import { toRecordId, useRecordLink, useResourceProperty } from '~/components/resources'

/**
 * `getEffectiveResource` (behind `useResourceProperty`) resolves both a
 * definition id and its `apiSlug`, so `sourceKind` values that are also
 * entity slugs (`order`, `invoice`, `credit_memo`, `vendor_bill`, …) resolve
 * straight through. Non-entity kinds (`gl_posting`, `stock_movement`,
 * `provider_ledger_entry`) have no definition and fall back to plain text; a
 * `money_transaction` is a `MovementBadge` now, not a string.
 */
export function LedgerSourceLink({
  sourceKind,
  sourceId,
}: {
  sourceKind: string
  sourceId: string
}) {
  const entityDefId = useResourceProperty(sourceKind, 'id')
  const recordId = entityDefId ? toRecordId(entityDefId, sourceId) : null
  const href = useRecordLink(recordId)
  const label = `${sourceKind}:${sourceId}`

  if (!href) {
    return <span className='truncate font-mono text-xs text-muted-foreground'>{label}</span>
  }
  return (
    <Link href={href} className='truncate font-mono text-xs text-primary-400 hover:underline'>
      {label}
    </Link>
  )
}
