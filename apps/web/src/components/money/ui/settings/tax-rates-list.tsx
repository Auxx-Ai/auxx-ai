// apps/web/src/components/money/ui/settings/tax-rates-list.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Percent, Plus } from 'lucide-react'
import type { TaxRate } from './tax-rate-types'

interface TaxRatesListProps {
  taxRates: TaxRate[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
}

/**
 * Left column of the Tax rates tab: flat `TreeRow` list backed by the
 * `documents.taxRates` org setting (no entity, no dialogs — see the Products
 * & Services tab / mcp-server-tools-tab for the shared master–detail recipe).
 */
export function TaxRatesList({ taxRates, selectedId, onSelect, onAdd }: TaxRatesListProps) {
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
                <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  {rate.rate}%
                  {rate.isDefault && (
                    <Badge variant='outline' size='xs'>
                      Default
                    </Badge>
                  )}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
