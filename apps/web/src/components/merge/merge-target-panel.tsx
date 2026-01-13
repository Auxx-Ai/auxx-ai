// apps/web/src/components/merge/merge-target-panel.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type { ResourceId } from '@auxx/lib/resources/client'
import { useRecord, useResource } from '~/components/resources'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EntityFields } from '../fields'
// import EntityFields from '~/components/fields/entity-fields'

interface MergeTargetPanelProps {
  /** ResourceId of the target record */
  resourceId: ResourceId
  /** Entity definition ID */
  entityDefinitionId: string | null
  /** Loading state */
  isLoading?: boolean
}

/**
 * Middle panel showing full card view of the target record.
 * Uses EntityFields for consistent field rendering.
 */
export function MergeTargetPanel({
  resourceId,
  entityDefinitionId,
  isLoading: externalLoading,
}: MergeTargetPanelProps) {
  const { record, isLoading: recordLoading } = useRecord({ resourceId })
  const { resource } = useResource(entityDefinitionId ?? '')

  const isLoading = externalLoading || recordLoading

  return (
    <div className="flex-1 flex flex-col border rounded-2xl bg-muted max-h-[400px]">
      {/* Header */}
      {/* <div className="px-3 py-2 border-b bg-muted/50">
        <h3 className="text-sm font-medium text-center">
          Merge Into {resource?.label ?? 'record'}
        </h3>
      </div> */}

      {/* Content */}
      <ScrollArea className="">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : record ? (
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
                    {record.displayName ?? 'Untitled'}
                  </span>
                  {record.secondaryDisplayValue && (
                    <p className="text-sm text-muted-foreground truncate">
                      {record.secondaryDisplayValue}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Fields - read-only view */}
            {/* TODO: Render EntityFields once ready */}
            <div className="p-1">
              <EntityFields
                resourceId={resourceId}
                className="[&_button]:hidden"
                canEdit={false}
                showTitle={false}
                readOnly
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No target selected
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
