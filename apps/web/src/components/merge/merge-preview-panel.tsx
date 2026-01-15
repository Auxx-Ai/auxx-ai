// apps/web/src/components/merge/merge-preview-panel.tsx
'use client'

import { useMemo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tooltip } from '~/components/global/tooltip'
import { type ResourceId } from '@auxx/lib/resources/client'
import { useRecords, useResource } from '~/components/resources'
import { EntityIcon } from '@auxx/ui/components/icons'
import { FieldDisplay } from '~/components/fields/field-display'
import { useMergePreview } from './use-merge-preview'

interface MergePreviewPanelProps {
  /** Target ResourceId */
  targetResourceId: ResourceId
  /** Source ResourceIds to merge from */
  sourceResourceIds: ResourceId[]
  /** Entity definition ID */
  entityDefinitionId: string | null
  /** Loading state */
  isLoading?: boolean
}

/**
 * Right panel showing preview of merged result.
 * Computes merged field values client-side:
 * - Single-value: target wins
 * - Multi-value: union of all values
 */
export function MergePreviewPanel({
  targetResourceId,
  sourceResourceIds,
  entityDefinitionId,
  isLoading: externalLoading,
}: MergePreviewPanelProps) {
  const allIds = useMemo(
    () => [targetResourceId, ...sourceResourceIds],
    [targetResourceId, sourceResourceIds]
  )

  const { records, isLoading: recordsLoading } = useRecords({ resourceIds: allIds })
  const { resource } = useResource(entityDefinitionId ?? '')

  const isLoading = externalLoading || recordsLoading
  // Use merge preview hook
  const { mergedFields } = useMergePreview({
    targetResourceId,
    sourceResourceIds,
    fields: resource?.fields ?? [],
  })
  console.log(
    'MergePreviewPanel mergedFields:',
    mergedFields,
    targetResourceId,
    sourceResourceIds,
    resource?.fields
  )
  // Get target record info
  const targetRecord = useMemo(() => records[0], [records])

  console.log('mergedFields:', mergedFields, records)

  return (
    <div className="flex-1 flex flex-col border rounded-2xl bg-muted max-h-[400px]">
      {/* Content */}
      <ScrollArea>
        {isLoading ? (
          <div className="space-y-3 p-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : targetRecord && resource?.fields && Object.keys(mergedFields).length > 0 ? (
          <div className="space-y-1">
            {/* Title */}
            <div className="flex flex-col gap-1 sticky top-0 z-20 backdrop-blur-sm me-2 rounded-2xl">
              <div className="flex items-start gap-2 px-2 pt-2">
                <EntityIcon
                  iconId={resource?.icon ?? 'document'}
                  color={resource?.color ?? 'gray'}
                />
                <div>
                  <span className="font-medium text-sm truncate">
                    {targetRecord.displayName ?? 'Untitled'}
                  </span>
                  {targetRecord.secondaryDisplayValue && (
                    <p className="text-sm text-muted-foreground truncate">
                      {String(targetRecord.secondaryDisplayValue)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Fields - merged preview */}
            <div className="p-1">
              <div className="group/entity-card bg-primary-100/50 dark:bg-primary-100 border rounded-2xl relative outline-none focus:outline-none">
                <div className="flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col">
                  {Object.entries(mergedFields).map(([fieldId, { value }]) => {
                    const field = resource.fields.find((f) => f.id === fieldId)
                    if (!field) return null

                    return (
                      <div className="group/row-wrapper" key={fieldId}>
                        <div
                          className="group/property-row flex w-full h-fit row group min-h-[30px]"
                          data-slot="property-row">
                          <Tooltip align="start" side="left" content={field.label}>
                            <div className="min-w-0 relative flex text-sm flex-1">
                              <div className="items-center flex-1 flex gap-[4px] w-full overflow-y-auto no-scrollbar">
                                <FieldDisplay field={field} value={value} />
                              </div>
                            </div>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground p-3">
            Select items to preview
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
