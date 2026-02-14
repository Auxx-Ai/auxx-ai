// apps/web/src/components/data-import/steps/step-review-values.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { InputSearch } from '@auxx/ui/components/input-search'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { VirtualList, VirtualListContent, VirtualListItems } from '~/components/virtual-list'
import { api } from '~/trpc/react'
import { useImportSSE } from '../hooks/use-import-sse'
import { ResolutionProgress } from '../progress/resolution-progress'
import type { UniqueValueSummary } from '../types'
import { ValueRow } from '../value-review/value-row'
import { ValueStatusGroup } from '../value-review/value-status-group'

/** Filter type for value display */
type ValueFilter = 'all' | 'overridden'

/** Filter options for the combobox */
const VALUE_FILTER_OPTIONS = [
  { value: 'all', label: 'Show All' },
  { value: 'overridden', label: 'Overwritten Only' },
]

interface StepReviewValuesProps {
  jobId: string
  onComplete: () => void
}

/** Status group configuration for the value review */
interface StatusGroup {
  status: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  values: UniqueValueSummary[]
}

/**
 * Step 3: Value review.
 * Two-panel layout: column sidebar + expandable status groups.
 */
export function StepReviewValues({ jobId, onComplete }: StepReviewValuesProps) {
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [valueFilter, setValueFilter] = useState<ValueFilter>('all')
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set())

  const { data: mappedColumns, isLoading } = api.dataImport.getMappedColumns.useQuery({ jobId })

  // Track if resolution is in progress (triggered but not complete via SSE)
  const [isResolutionActive, setIsResolutionActive] = useState(false)

  const { data: job } = api.dataImport.getJob.useQuery(
    { jobId },
    {
      // Poll while resolution is active to detect completion
      refetchInterval: isResolutionActive ? 1000 : false,
    }
  )
  const { data: columnData } = api.dataImport.getUniqueValues.useQuery(
    { jobId, columnIndex: Number(selectedColumn) },
    { enabled: selectedColumn !== null }
  )

  // Extract values and fieldConfig from column data
  const uniqueValues = columnData?.values
  const fieldConfig = columnData?.fieldConfig ?? null

  const resolveValues = api.dataImport.resolveColumnValues.useMutation()
  const utils = api.useUtils()

  // Track if we've already triggered auto-resolution for this session
  const hasTriggeredResolution = useRef(false)

  // SSE connection for real-time resolution progress
  useImportSSE({
    jobId,
    enabled: isResolutionActive,
    onResolutionComplete: () => {
      setIsResolutionActive(false)
      // Invalidate queries to refresh data with resolved values
      utils.dataImport.getJob.invalidate({ jobId })
      utils.dataImport.getUniqueValues.invalidate()
      utils.dataImport.getMappedColumns.invalidate({ jobId })
    },
  })

  // Auto-trigger resolution when entering step 3 if allowPlanGeneration is false
  useEffect(() => {
    if (
      job &&
      job.allowPlanGeneration === false &&
      !hasTriggeredResolution.current &&
      !isResolutionActive
    ) {
      hasTriggeredResolution.current = true
      setIsResolutionActive(true)

      // Trigger resolution - onComplete from ResolutionProgress will handle completion
      resolveValues.mutate({ jobId })
    }
  }, [job?.allowPlanGeneration, jobId, isResolutionActive, resolveValues])

  // Detect resolution completion via polling (backup for SSE)
  // Also reset auto-trigger flag when allowPlanGeneration becomes true
  useEffect(() => {
    if (job?.allowPlanGeneration === true) {
      // Resolution complete - exit resolving state
      if (isResolutionActive) {
        setIsResolutionActive(false)
        utils.dataImport.getUniqueValues.invalidate()
        utils.dataImport.getMappedColumns.invalidate({ jobId })
      }
      // Reset flag so re-resolution can be triggered if mappings change
      hasTriggeredResolution.current = false
    }
  }, [job?.allowPlanGeneration, isResolutionActive, jobId, utils.dataImport])

  // Set first column as selected when data loads
  useEffect(() => {
    if (!selectedColumn && mappedColumns?.[0]) {
      setSelectedColumn(mappedColumns[0].columnIndex.toString())
    }
  }, [mappedColumns, selectedColumn])

  const handleResolveAll = () => {
    setIsResolutionActive(true)
    resolveValues.mutate({ jobId })
  }

  const toggleStatus = (status: string) => {
    setExpandedStatuses((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(status)) {
        newSet.delete(status)
      } else {
        newSet.add(status)
      }
      return newSet
    })
  }

  const totalErrors = mappedColumns?.reduce((sum, col) => sum + (col.errorCount ?? 0), 0) ?? 0

  /** User can continue even with errors - those rows simply won't be imported */
  const canContinue = ['waiting', 'ready', 'executing'].includes(job?.status ?? '')

  // Filter values by search and override status
  const filteredValues = useMemo(() => {
    let values = uniqueValues ?? []

    // Apply search filter
    if (searchQuery) {
      values = values.filter((v) => v.rawValue.toLowerCase().includes(searchQuery.toLowerCase()))
    }

    // Apply override filter
    if (valueFilter === 'overridden') {
      values = values.filter((v) => v.isOverridden)
    }

    return values
  }, [uniqueValues, searchQuery, valueFilter])

  // Group by originalStatus (keeps values in place after override)
  const statusGroups: StatusGroup[] = useMemo(
    () => [
      {
        status: 'pending',
        label: 'Pending Review',
        icon: Clock,
        color: 'text-muted-foreground',
        bgColor: 'bg-primary-150 ring-1 ring-primary-200',
        values: filteredValues?.filter((v) => v.originalStatus === 'pending') ?? [],
      },
      {
        status: 'error',
        label: 'Errors',
        icon: AlertCircle,
        color: 'text-destructive',
        bgColor: 'bg-primary-150 ring-1 ring-primary-200',
        values: filteredValues?.filter((v) => v.originalStatus === 'error') ?? [],
      },
      {
        status: 'warning',
        label: 'Warnings',
        icon: AlertTriangle,
        color: 'text-yellow-600',
        bgColor: 'bg-primary-150 ring-1 ring-primary-200',
        values: filteredValues?.filter((v) => v.originalStatus === 'warning') ?? [],
      },
      {
        status: 'create',
        label: 'Will Create',
        icon: Plus,
        color: 'text-blue-600',
        bgColor: 'bg-primary-150 ring-1 ring-primary-200',
        values: filteredValues?.filter((v) => v.originalStatus === 'create') ?? [],
      },
      {
        status: 'valid',
        label: 'Valid',
        icon: CheckCircle2,
        color: 'text-green-600',
        bgColor: 'bg-primary-150 ring-1 ring-primary-200',
        values: filteredValues?.filter((v) => v.originalStatus === 'valid') ?? [],
      },
    ],
    [filteredValues]
  )

  /** Filter status groups to only show non-empty ones */
  const nonEmptyGroups = useMemo(
    () => statusGroups.filter((group) => group.values.length > 0),
    [statusGroups]
  )

  // Expand first available group by default when data loads
  const hasInitializedExpanded = useRef(false)
  useEffect(() => {
    if (nonEmptyGroups.length > 0 && !hasInitializedExpanded.current) {
      hasInitializedExpanded.current = true
      setExpandedStatuses(new Set([nonEmptyGroups[0]!.status]))
    }
  }, [nonEmptyGroups])

  const selectedColumnData = mappedColumns?.find((c) => c.columnIndex.toString() === selectedColumn)

  // Handle resolution completion from ResolutionProgress polling
  const handleResolutionComplete = () => {
    setIsResolutionActive(false)
    utils.dataImport.getJob.invalidate({ jobId })
    utils.dataImport.getUniqueValues.invalidate()
    utils.dataImport.getMappedColumns.invalidate({ jobId })
  }

  // Show resolution progress when resolving or loading
  // Note: Only use isResolutionActive, not resolveValues.isPending
  // The mutation's isPending can be unreliable when managing state manually
  if (isLoading) {
    return <ResolutionProgress jobId={jobId} variant='loading' enabled={false} />
  }
  if (isResolutionActive) {
    return (
      <ResolutionProgress
        jobId={jobId}
        variant='resolving'
        enabled={isResolutionActive}
        onComplete={handleResolutionComplete}
      />
    )
  }

  return (
    <div className='flex flex-1 flex-row justify-start w-full min-h-0 overflow-hidden'>
      {/* Sidebar - Column Selection */}
      <div className='w-64 border-r bg-muted/30 flex flex-col'>
        <ScrollArea className='flex-1'>
          <h3 className='px-3 h-10 flex z-10 items-center pb-0 text-sm font-semibold text-muted-foreground sticky top-0 bg-muted/30 backdrop-blur border-b'>
            Columns
          </h3>
          <div className='p-3'>
            <RadioGroup value={selectedColumn ?? ''} onValueChange={setSelectedColumn}>
              {mappedColumns?.map((col) => (
                <RadioGroupItemCard
                  key={col.columnIndex}
                  label={col.columnName}
                  value={col.columnIndex.toString()}
                  description={`${col.uniqueCount} unique values`}
                  icon={
                    col.errorCount > 0 ? (
                      <>
                        <AlertCircle className='size-4 text-destructive' />
                        <div className='absolute -right-2.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full border border-black/10 bg-bad-500 dark:bg-bad-300 text-[9px] font-semibold text-white'>
                          {col.errorCount}
                        </div>
                      </>
                    ) : (
                      <CheckCircle2 className='size-4 text-green-600' />
                    )
                  }
                />
              ))}
            </RadioGroup>
          </div>
        </ScrollArea>

        {/* Continue button in sidebar footer */}
        <div className='px-3 h-12 flex items-center border-t bg-muted/50'>
          <Button onClick={onComplete} disabled={!canContinue} className='w-full'>
            {totalErrors > 0 ? `Fix ${totalErrors} Errors` : 'Continue'}
          </Button>
        </div>
      </div>

      {/* Main Content - Value List */}
      <div className='flex-1 overflow-hidden flex flex-col bg-background'>
        {/* Header with search and actions */}
        <div className='h-10 shrink-0 flex items-center justify-between border-b px-2 gap-2 bg-primary-200/50'>
          <div className='flex-1 max-w-sm'>
            <InputSearch
              placeholder='Search values...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery('')}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Combobox
              options={VALUE_FILTER_OPTIONS}
              value={valueFilter}
              onChangeValue={(v) => setValueFilter((v as ValueFilter) || 'all')}
              placeholder='Filter'
              emptyText='No options'
              align='end'
              loading={false}
              variant='outline'
              size='sm'
            />
            <Button variant='outline' size='sm' onClick={handleResolveAll}>
              <RefreshCw />
              Re-resolve
            </Button>
          </div>
        </div>

        {/* Status groups */}
        <div className='flex-1 overflow-y-auto'>
          {nonEmptyGroups.map((group) => {
            const isExpanded = expandedStatuses.has(group.status)

            return (
              <div key={group.status}>
                <ValueStatusGroup
                  status={group.status}
                  label={group.label}
                  icon={group.icon}
                  color={group.color}
                  count={group.values.length}
                  isExpanded={isExpanded}
                  onToggle={() => toggleStatus(group.status)}
                />
                {isExpanded && (
                  <div className={cn('p-4 bg-background')}>
                    <div className='bg-primary-200/30 rounded-2xl shadow-sm border'>
                      <VirtualList
                        items={group.values}
                        estimateSize={36}
                        overscan={5}
                        getItemKey={(value) => value.hash}>
                        <VirtualListContent>
                          <VirtualListItems<UniqueValueSummary>
                            getItemId={(value) => value.hash}
                            renderItem={(value) => (
                              <ValueRow
                                value={value}
                                jobId={jobId}
                                columnIndex={Number(selectedColumn)}
                                fieldConfig={fieldConfig}
                              />
                            )}
                          />
                        </VirtualListContent>
                      </VirtualList>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer with count */}
        {filteredValues && filteredValues.length > 0 && (
          <div className='border-t px-4 flex items-center h-12 bg-muted/30'>
            <p className='text-sm text-muted-foreground'>
              Showing {filteredValues.length} value{filteredValues.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
