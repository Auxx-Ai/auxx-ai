// apps/web/src/components/data-import/value-review/value-row.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ArrowRight, Ban, Check, RotateCcw } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { api } from '~/trpc/react'
import type {
  ColumnFieldConfig,
  EffectiveStatus,
  OverrideValue,
  UniqueValueSummary,
} from '../types'
import { EditingInput } from './editing-input'

interface ValueRowProps {
  value: UniqueValueSummary
  jobId: string
  columnIndex: number
  fieldConfig: ColumnFieldConfig | null
}

/**
 * Derive new effective status from override.
 */
function deriveEffectiveStatus(
  originalStatus: UniqueValueSummary['originalStatus'],
  isOverridden: boolean,
  overrideValues: OverrideValue[] | null
): EffectiveStatus {
  if (!isOverridden || !overrideValues?.length) {
    return originalStatus
  }
  if (overrideValues[0].type === 'skip') {
    return 'skip'
  }
  return 'valid'
}

/**
 * Single value row within an expanded status group.
 * Shows the raw value, occurrence count, and allows editing/overriding.
 */
export function ValueRow({ value, jobId, columnIndex, fieldConfig }: ValueRowProps) {
  const updateResolution = api.dataImport.updateValueResolution.useMutation()
  const utils = api.useUtils()

  /** Check if value is skipped */
  const isSkipped = value.effectiveStatus === 'skip'

  /** Check if value has a custom override (not skip) */
  const hasCustomOverride = value.isOverridden && value.overrideValues?.[0]?.type !== 'skip'

  /** Check if error/warning was fixed (originalStatus was bad, now valid) */
  const isFixed =
    (value.originalStatus === 'error' || value.originalStatus === 'warning') &&
    value.effectiveStatus === 'valid'

  /** Save override or clear it with optimistic update */
  const handleSave = async (isOverridden: boolean, overrideValues: OverrideValue[] | null) => {
    // Calculate new effective status for optimistic update
    const newEffectiveStatus = deriveEffectiveStatus(
      value.originalStatus,
      isOverridden,
      overrideValues
    )

    // Optimistically update the cache BEFORE the mutation
    utils.dataImport.getUniqueValues.setData({ jobId, columnIndex }, (oldData) => {
      if (!oldData) return oldData
      return {
        ...oldData,
        values: oldData.values.map((v) =>
          v.hash === value.hash
            ? {
                ...v,
                isOverridden,
                overrideValues,
                effectiveStatus: newEffectiveStatus,
              }
            : v
        ),
      }
    })

    try {
      await updateResolution.mutateAsync({
        jobId,
        columnIndex,
        hash: value.hash,
        isOverridden,
        overrideValues,
      })
    } catch (error) {
      // Rollback on error - refetch to get correct state
      utils.dataImport.getUniqueValues.invalidate({ jobId, columnIndex })
      throw error
    }
  }

  /** Skip this value */
  const handleSkip = () => {
    handleSave(true, [{ type: 'skip', value: '' }])
  }

  /** Revert to auto-resolved value */
  const handleRevert = () => {
    handleSave(false, null)
  }

  /** Handle save from input - null means revert to original */
  const handleInputSave = (newOverrideValues: OverrideValue[] | null) => {
    if (newOverrideValues) {
      handleSave(true, newOverrideValues)
    } else {
      // Revert to original
      handleSave(false, null)
    }
  }

  return (
    <div
      className={cn(
        'bg-primary-200/30 group flex items-center justify-between ps-3 h-8 transition-colors border-b [[data-first]_&]:rounded-t-xl [[data-last]_&]:rounded-b-xl [[data-last]_&]:border-b-0'
      )}>
      {/* Raw value column */}
      <div className={cn('min-w-0 flex-[0.4]', isSkipped && 'opacity-50')}>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'font-mono text-sm truncate text-primary-600',
              isSkipped && 'line-through opacity-50'
            )}
            title={value.rawValue}>
            {value.rawValue || <span className='text-muted-foreground italic'>empty</span>}
          </span>
          <Badge variant='outline' className='text-xs shrink-0'>
            {value.count.toLocaleString()} row{value.count !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Arrow */}
      <div className={cn('flex flex-[0.2] justify-center', isSkipped && 'opacity-50')}>
        <ArrowRight className={cn('size-4 text-muted-foreground')} />
      </div>

      {/* Resolved value column */}
      <div
        className='min-w-0 flex-[0.4] flex items-center h-full'
        onClick={(e) => e.stopPropagation()}>
        <div className='flex-1'>
          {isSkipped ? (
            <Badge variant='outline' className='opacity-50'>
              Skipped
            </Badge>
          ) : (
            <EditingInput
              fieldConfig={fieldConfig}
              rawValue={value.rawValue}
              resolvedValue={value.resolvedValue}
              isOverridden={value.isOverridden}
              overrideValues={value.overrideValues}
              hasCustomOverride={hasCustomOverride}
              onSave={handleInputSave}
            />
          )}
        </div>

        {/* Action buttons */}
        {/* <div className="flex items-center opacity-0 group-hover:opacity-100 pe-1 transition-opacity overflow-hidden [[data-first]_&]:rounded-tr-2xl [[data-last]_&]:rounded-br-2xl"> */}
        <div className='rounded-md px-0.5 items-center bg-input/50 border h-6.5 border-primary-200 flex me-2 gap-0.5'>
          {/* Fixed indicator - show when error/warning was resolved */}
          {isFixed && (
            <Tooltip content='Fixed'>
              <div className='h-5.5 w-5.5 px-1 flex items-center justify-center rounded-[6px] text-green-600 dark:text-green-500 bg-green-400/40 dark:bg-green-900'>
                <Check />
              </div>
            </Tooltip>
          )}

          {/* Error indicator - show when there's an error and not fixed */}
          {value.errorMessage && !isFixed && (
            <Tooltip content={value.errorMessage}>
              <div className='h-5.5 w-5.5 px-1 flex items-center justify-center rounded-[6px] text-red-600 dark:text-red-500 bg-red-400/40 dark:bg-red-900'>
                <AlertTriangle />
              </div>
            </Tooltip>
          )}

          {/* Revert button - only show if there are changes (isOverridden) */}
          {value.isOverridden && (
            <Tooltip content='Revert to original'>
              <Button
                variant='transparent'
                className='h-5.5 w-5.5 px-1 bg-primary-200 rounded-md border'
                onClick={handleRevert}>
                <RotateCcw className='text-muted-foreground' />
              </Button>
            </Tooltip>
          )}

          {/* Skip button - only show if not already skipped */}
          {!isSkipped && (
            <Tooltip content='Skip value'>
              <Button
                variant='transparent'
                className='h-5.5 w-5.5 rounded-[6px] px-1 text-amber-600 dark:text-amber-500! bg-amber-400/40 hover:bg-amber-400/60 dark:bg-amber-900!'
                onClick={handleSkip}>
                <Ban />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
