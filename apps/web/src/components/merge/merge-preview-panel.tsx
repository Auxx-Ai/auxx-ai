// apps/web/src/components/merge/merge-preview-panel.tsx
'use client'

import { useMemo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Badge } from '@auxx/ui/components/badge'
import { type ResourceId } from '@auxx/lib/resources/client'
import { useRecords, useResource } from '~/components/resources'
import { isMultiValueFieldType } from '@auxx/lib/field-values/client'

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

  // Compute merged preview
  const mergedPreview = useMemo(() => {
    if (!resource?.fields || records.length === 0) return null

    const targetRecord = records[0]
    if (!targetRecord) return null

    const merged: Record<string, { label: string; value: unknown; merged: boolean }> = {}

    for (const field of resource.fields) {
      if (!field.id || field.isSystem) continue

      const isMulti = isMultiValueFieldType(field.fieldType ?? 'TEXT')
      const targetValue = targetRecord.fieldValues?.[field.id]

      if (isMulti) {
        // Multi-value: collect all values from all records
        const allValues = new Set<string>()
        for (const record of records) {
          const val = record?.fieldValues?.[field.id]
          if (Array.isArray(val)) {
            val.forEach((v) => allValues.add(String(v)))
          } else if (val) {
            allValues.add(String(val))
          }
        }
        const mergedArray = Array.from(allValues)
        merged[field.id] = {
          label: field.label,
          value: mergedArray,
          merged: mergedArray.length > (Array.isArray(targetValue) ? targetValue.length : 0),
        }
      } else {
        // Single-value: target wins, show indicator if sources differ
        const hasConflict = sourceResourceIds.some((_, idx) => {
          const sourceRecord = records[idx + 1]
          const sourceValue = sourceRecord?.fieldValues?.[field.id]
          return sourceValue !== undefined && sourceValue !== targetValue
        })
        merged[field.id] = {
          label: field.label,
          value: targetValue,
          merged: hasConflict,
        }
      }
    }

    return { displayName: targetRecord.displayName, fields: merged }
  }, [resource, records, sourceResourceIds])

  return (
    <div className="flex flex-col h-full flex-1 border rounded-2xl bg-muted">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-muted/50">
        <h3 className="text-sm font-medium">Merged Result</h3>
        <p className="text-xs text-muted-foreground">Preview of final record</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : mergedPreview ? (
          <div className="space-y-4">
            {/* Title */}
            <h4 className="font-semibold text-lg truncate">
              {mergedPreview.displayName ?? 'Untitled'}
            </h4>

            {/* Merged fields */}
            <div className="space-y-2">
              {Object.entries(mergedPreview.fields).map(([fieldId, { label, value, merged }]) => (
                <div key={fieldId} className="flex items-start gap-2">
                  <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5">
                    {label}
                  </span>
                  <div className="flex-1 text-sm">
                    {Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1">
                        {value.map((v, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span>{String(value ?? '—')}</span>
                    )}
                    {merged && (
                      <Badge variant="outline" className="ml-1 text-xs text-info">
                        merged
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select items to preview
          </div>
        )}
      </div>
    </div>
  )
}
