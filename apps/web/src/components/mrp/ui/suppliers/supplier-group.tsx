// apps/web/src/components/mrp/ui/suppliers/supplier-group.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Building2, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { suggestionTotal } from '../plan/plan-tabs'
import { formatOrderBy } from '../rows/format'
import { GroupRow } from '../rows/group-row'
import { type MrpListRow, MrpRow } from '../rows/mrp-row'
import { useSupplierDraft } from './use-supplier-draft'

/** One `mrp.supplierNextOrder` card. */
export type SupplierCard = RouterOutputs['mrp']['supplierNextOrder']['suppliers'][number]

export interface SupplierGroupProps {
  card: SupplierCard
  /** The run's rows by part id; the card's parts render through them. */
  rows: ReadonlyMap<string, MrpListRow>
  runId: string | null | undefined
  onOpenPart: (partId: string) => void
  activePartId?: string | null
}

/** A when-needed supplier (07 §4.2): a `GroupRow` over its purchase rows, "Create draft PO" drafting them as one PO. */
export function SupplierGroup({ card, rows, runId, onOpenPart, activePartId }: SupplierGroupProps) {
  const [open, setOpen] = useState(true)
  const items = card.parts.flatMap((part) => rows.get(part.partId) ?? [])
  const purchase = items.filter((item) => item.suggestionKind === 'purchase')
  const nameOf = (partId: string) =>
    card.parts.find((part) => part.partId === partId)?.name ?? 'Unnamed part'
  const { draft, canManage, isPending } = useSupplierDraft(runId, nameOf)
  const name = card.name ?? 'Unnamed supplier'

  return (
    <GroupRow
      icon={<Building2 className='size-4 text-muted-foreground' />}
      label={name}
      count={[
        `${card.parts.length} ${card.parts.length === 1 ? 'part' : 'parts'}`,
        'when needed',
        card.nextOrderDate ? `first order-by ${formatOrderBy(card.nextOrderDate)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      total={suggestionTotal(purchase)}
      itemIds={items.map((item) => item.partId)}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      actions={
        <Button
          variant='outline'
          size='xs'
          disabled={!canManage || purchase.length === 0}
          title={canManage ? undefined : 'Needs MRP manage'}
          loading={isPending}
          loadingText='Drafting...'
          onClick={(event) => {
            event.stopPropagation()
            void draft(purchase.map((item) => ({ partId: item.partId })))
          }}>
          <ShoppingCart />
          Create draft PO
        </Button>
      }>
      {items.map((item) => (
        <MrpRow
          key={item.partId}
          item={item}
          depth={1}
          active={item.partId === activePartId}
          onOpen={onOpenPart}
        />
      ))}
    </GroupRow>
  )
}
