// apps/web/src/components/money/ui/settings/tax-rates-list.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Percent, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import type { TaxRate } from './tax-rate-types'

interface TaxRatesListProps {
  taxRates: TaxRate[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onSetDefault: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Left column of the Tax rates tab: flat `TreeRow` list backed by the
 * `documents.taxRates` org setting (no entity, no dialogs — see the Products
 * & Services tab / mcp-server-tools-tab for the shared master–detail recipe).
 * The default rate is a toggle badge on each row (set-only — one rate is always
 * the default), not an editor field.
 */
export function TaxRatesList({
  taxRates,
  selectedId,
  onSelect,
  onAdd,
  onSetDefault,
  onDelete,
}: TaxRatesListProps) {
  const [confirm, ConfirmDialog] = useConfirm()

  async function handleDelete(rate: TaxRate) {
    const confirmed = await confirm({
      title: 'Delete tax rate?',
      description: `“${rate.name}” will be removed. Existing documents keep their applied tax.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (confirmed) onDelete(rate.id)
  }

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center justify-end'>
        <Button variant='outline' size='sm' onClick={onAdd}>
          <Plus />
          Add rate
        </Button>
      </div>

      {taxRates.length === 0 ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>
          No tax rates yet — add your first rate.
        </div>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {taxRates.map((rate) => (
            <TreeRow
              key={rate.id}
              icon={<Percent className='size-4 text-muted-foreground' />}
              title={rate.name}
              onToggleOpen={() => onSelect(rate.id)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === rate.id && 'bg-primary-100 ring-1 ring-primary-200'
              )}
              secondary={
                <span className='flex items-center gap-1.5 text-xs text-muted-foreground p-[3px]'>
                  {rate.rate}%
                  {rate.isDefault ? (
                    <Badge variant='magenta' size='xs'>
                      Default
                    </Badge>
                  ) : (
                    <Badge
                      variant='outline'
                      size='xs'
                      className='text-muted-foreground hover:text-primary-700'
                      onClick={(e) => {
                        e.stopPropagation()
                        onSetDefault(rate.id)
                      }}>
                      Set default
                    </Badge>
                  )}
                </span>
              }
              actions={
                <TreeRowButton
                  tooltipText='Delete rate'
                  variant='destructive'
                  onClick={() => handleDelete(rate)}>
                  <Trash2 />
                </TreeRowButton>
              }
            />
          ))}
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
