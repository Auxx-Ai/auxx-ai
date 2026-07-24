// apps/web/src/components/fields/compact-field-list.tsx
'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResourceFields } from '~/components/resources'
import { CompactFieldRow } from './compact-field-row'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { useFieldPopoverCoordination } from './hooks/use-field-popover-coordination'

interface CompactFieldListProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Whether all fields are read-only */
  readOnly?: boolean
  /** Field keys never relevant to the compact viewer (e.g. system audit fields) */
  excludeFields?: string[]
}

/**
 * System fields that never make sense in the compact embed: timestamps and
 * the raw id. Always hidden — the surrounding chrome (extension iframe) does
 * not provide a way to toggle them back.
 */
const HIDDEN_SYSTEM_FIELDS = ['createdAt', 'updatedAt', 'id']

/**
 * Slim, embed-friendly counterpart to `EntityFields`. Renders the same
 * `PropertyProvider` + `PropertyRow` editing surface, but drops drag-and-
 * drop reorder, edit-mode, visibility toggles, the custom-field dialog,
 * and keyboard navigation.
 *
 * Used by the extension's `/embed/record/[recordId]` page; can also be
 * used by the web app wherever a lighter field surface is desired.
 */
export function CompactFieldList({
  recordId,
  readOnly = false,
  excludeFields,
}: CompactFieldListProps) {
  const { entityDefinitionId } = parseRecordId(recordId)

  const { fields: effectiveFields, isLoading } = useResourceFields(entityDefinitionId)
  const { fields: enrichedFields, isLoading: optionsLoading } =
    useDynamicFieldOptions(effectiveFields)

  // Apply the fixed system-field hide list plus any caller-supplied excludes.
  const visibleFields = useMemo(() => {
    const blocked = new Set([...HIDDEN_SYSTEM_FIELDS, ...(excludeFields ?? [])])
    return enrichedFields.filter((field) => !blocked.has(field.key))
  }, [enrichedFields, excludeFields])

  // Same one-open-at-a-time behaviour as `EntityFields`, without a FieldNavigationProvider.
  const { onOpenChange, registerClose, unregisterClose } = useFieldPopoverCoordination()

  const loading = isLoading || optionsLoading

  return (
    <div className='flex flex-col'>
      {visibleFields.map((field) => {
        const providerId = field.id ?? field.key
        return (
          <CompactFieldRow
            key={providerId}
            providerId={providerId}
            field={field}
            loading={loading}
            recordId={recordId}
            readOnly={readOnly || field.capabilities?.updatable === false}
            onOpenChange={onOpenChange}
            registerClose={registerClose}
            unregisterClose={unregisterClose}
          />
        )
      })}
    </div>
  )
}
