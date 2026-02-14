// apps/web/src/components/merge/merge-source-panel.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ArrowRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { RecordPickerContent } from '~/components/pickers/record-picker'
import { MergeItemCard } from './merge-item-card'

interface MergeSourcePanelProps {
  /** Entity definition ID for filtering picker */
  entityDefinitionId: string | null
  /** List of source RecordIds to be merged */
  sourceRecordIds: RecordId[]
  /** The target RecordId (excluded from picker) */
  targetRecordId: RecordId
  /** Callback when new sources are added */
  onAddSources: (recordIds: RecordId[]) => void
  /** Callback when a source is removed */
  onRemoveSource: (recordId: RecordId) => void
  /** Callback when a source should become the target */
  onSetAsTarget: (recordId: RecordId) => void
  /** Loading state */
  isLoading?: boolean
}

/**
 * Left panel showing source items to be merged.
 * Empty state shows centered plus icon.
 */
export function MergeSourcePanel({
  entityDefinitionId,
  sourceRecordIds,
  targetRecordId,
  onAddSources,
  onRemoveSource,
  onSetAsTarget,
  isLoading,
}: MergeSourcePanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const isEmpty = sourceRecordIds.length === 0

  // Exclude already-selected items from picker
  const excludeIds = [targetRecordId, ...sourceRecordIds]

  /** Handle picker selection */
  const handlePickerChange = (selected: RecordId[]) => {
    if (selected.length > 0) {
      onAddSources(selected)
    }
  }

  return (
    <div className='flex-1 flex flex-col border rounded-2xl bg-muted'>
      {/* Header */}
      {/* <div className="px-3 py-2 border-b bg-muted/50">
        <h3 className="text-sm font-medium">Items to Merge</h3>
        <p className="text-xs text-muted-foreground">
          {sourceResourceIds.length} item{sourceResourceIds.length !== 1 ? 's' : ''}
        </p>
      </div> */}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        {/* Content */}
        <div className='flex-1 overflow-auto p-2'>
          {isEmpty ? (
            /* Empty state: centered plus icon - entire area is clickable */
            <PopoverTrigger asChild>
              <div className='h-full flex items-center justify-center cursor-pointer hover:bg-muted/50 rounded-lg transition-colors'>
                <div className='flex flex-col items-center text-muted-foreground/50'>
                  <EntityIcon variant='muted' iconId='plus' size='lg' />
                  <p className='text-xs mt-2'>Add items to merge</p>
                </div>
              </div>
            </PopoverTrigger>
          ) : (
            /* Source items list */
            <div className='space-y-1'>
              {sourceRecordIds.map((recordId) => (
                <MergeItemCard
                  key={recordId}
                  recordId={recordId}
                  actions={
                    <>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        className='size-6 opacity-0 group-hover:opacity-100'
                        onClick={() => onSetAsTarget(recordId)}
                        title='Set as target'>
                        <ArrowRight className='size-3' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        className='size-6 opacity-0 group-hover:opacity-100'
                        onClick={() => onRemoveSource(recordId)}
                        title='Remove'>
                        <X className='size-3' />
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Add button - only shown when not empty */}
        {!isEmpty && (
          <div className='p-2 border-t'>
            <PopoverTrigger asChild>
              <Button variant='outline' className='w-full' size='sm'>
                <Plus /> Add Items
              </Button>
            </PopoverTrigger>
          </div>
        )}

        <PopoverContent className='w-[300px] p-0' align='start'>
          <RecordPickerContent
            value={sourceRecordIds}
            onChange={handlePickerChange}
            entityDefinitionId={entityDefinitionId ?? undefined}
            multi={true}
            placeholder='Search items...'
            excludeIds={excludeIds}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
