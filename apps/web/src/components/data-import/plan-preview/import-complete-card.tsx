// apps/web/src/components/data-import/plan-preview/import-complete-card.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Ban, CheckCircle2, Plus, RefreshCw } from 'lucide-react'

interface ImportCompleteCardProps {
  entityDefinitionId: string
  statistics: {
    created: number
    updated: number
    skipped: number
  }
  onComplete: () => void
}

/**
 * Card displayed when import is complete, showing final statistics.
 */
export function ImportCompleteCard({
  entityDefinitionId,
  statistics,
  onComplete,
}: ImportCompleteCardProps) {
  return (
    <div className='flex flex-col items-center justify-center flex-1'>
      <div className='w-full max-w-[360px] border rounded-2xl overflow-hidden'>
        {/* Header with success icon */}
        <div className='flex items-center justify-between p-4 border-b'>
          <div className='flex items-center gap-3 min-w-0'>
            <EntityIcon iconId='check' variant='muted' />
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Import Complete</p>
              <p className='text-sm text-muted-foreground'>{entityDefinitionId}</p>
            </div>
          </div>
          <CheckCircle2 className='size-5 text-green-500' />
        </div>

        {/* Stats row */}
        <div className='grid grid-cols-3 divide-x'>
          <div className='p-4 text-center'>
            <div className='flex items-center justify-center gap-1.5 text-muted-foreground mb-1'>
              <Plus className='size-3.5' />
              <span className='text-xs font-medium'>Created</span>
            </div>
            <p className='text-2xl font-bold'>{statistics.created.toLocaleString()}</p>
          </div>
          <div className='p-4 text-center'>
            <div className='flex items-center justify-center gap-1.5 text-muted-foreground mb-1'>
              <RefreshCw className='size-3.5' />
              <span className='text-xs font-medium'>Updated</span>
            </div>
            <p className='text-2xl font-bold'>{statistics.updated.toLocaleString()}</p>
          </div>
          <div className='p-4 text-center'>
            <div className='flex items-center justify-center gap-1.5 text-muted-foreground mb-1'>
              <Ban className='size-3.5' />
              <span className='text-xs font-medium'>Skipped</span>
            </div>
            <p className='text-2xl font-bold'>{statistics.skipped.toLocaleString()}</p>
          </div>
        </div>

        {/* Done button */}
        <div className='p-4 border-t bg-muted/30'>
          <Button onClick={onComplete} className='w-full'>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
