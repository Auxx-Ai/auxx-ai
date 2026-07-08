// apps/web/src/components/dynamic-table/cells/primary-field-cell.tsx
'use client'

import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import {
  buildFieldValueKey,
  type FieldId,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import { extractValue, type TypedFieldValue } from '@auxx/types/field-value'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { memo, type ReactNode, useMemo } from 'react'
import { ConnectorSourceBadge } from '~/components/fields/connector-source-badge'
import { toRecordId, useRecord, useResource } from '~/components/resources'
import { useField } from '~/components/resources/hooks/use-field'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { computedFieldRegistry } from '~/components/resources/store/computed-field-registry'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { PrimaryCell } from './primary-cell'

/**
 * Props for PrimaryFieldCell component
 */
interface PrimaryFieldCellProps {
  /** ResourceFieldId in format "entityDefinitionId:fieldId" */
  resourceFieldId: ResourceFieldId
  /** Row ID (record's unique identifier) */
  rowId: string
  /** Click handler for the title */
  onTitleClick: () => void
  /**
   * Dropdown menu items passed as children. When omitted, the hover kebab menu
   * is not rendered (widget/read-only use).
   */
  children?: ReactNode
}

/**
 * Primary field cell that subscribes directly to the Zustand store.
 * Uses useFieldValue for reactive value updates, ensuring the cell
 * re-renders when values are fetched or updated.
 *
 * This component wraps PrimaryCell with store subscription logic,
 * following the same pattern as CustomFieldCell.
 */
export const PrimaryFieldCell = memo(function PrimaryFieldCell({
  resourceFieldId,
  rowId,
  onTitleClick,
  children,
}: PrimaryFieldCellProps) {
  // Extract entityDefinitionId and fieldId from ResourceFieldId
  const { entityDefinitionId, fieldId } = useMemo(
    () => parseResourceFieldId(resourceFieldId),
    [resourceFieldId]
  )

  // Build recordId from entityDefinitionId and rowId
  const recordId = useMemo(() => toRecordId(entityDefinitionId, rowId), [entityDefinitionId, rowId])

  // Direct store subscription - triggers re-render when value changes
  // autoFetch ensures isLoading=true on first render (queues synchronously)
  const { value, isLoading } = useFieldValue(recordId, fieldId, { autoFetch: true })

  // Computed primary fields (e.g. NAME = firstName + lastName) never mark their own key as
  // fetching — the fetch queue decomposes them into source fields, so this cell's
  // `isLoading` is permanently false and it would flash "Untitled" instead of a skeleton.
  // Derive a real loading signal from the source fields' fetching state, which `setValues`
  // clears on both success and failure (so the skeleton can't hang); fall back to
  // `isLoading` for plain fields. This gate and the fetch queue branch on the same
  // registry, so they stay consistent whether or not the registry has synced yet.
  const computedConfig = computedFieldRegistry.getConfig(resourceFieldId)
  const sourcesFetching = useFieldValueStore((s) => {
    if (!computedConfig) return false
    for (const sourceFieldId of Object.values(computedConfig.sourceFields)) {
      if (buildFieldValueKey(recordId, sourceFieldId as FieldId) in s.fetchingKeys) return true
    }
    return false
  })
  const isResolving = computedConfig ? sourcesFetching : isLoading

  // Get record (already in store from batch fetch) for avatarUrl
  const { record } = useRecord({ recordId })
  const { resource } = useResource(entityDefinitionId)

  // Get field metadata
  const field = useField(resourceFieldId)
  const fieldType = field?.fieldType

  // Format value for display
  const displayValue: string | null = useMemo(() => {
    if (value == null) return null
    // TypedFieldValue from store: format with the field type when known. If the field
    // metadata hasn't resolved yet (fieldType undefined), fall back to the value's own
    // primitive so we never stringify the object into "[object Object]".
    if (typeof value === 'object' && 'type' in value) {
      if (fieldType) {
        const formatted = formatToDisplayValue(value as TypedFieldValue, fieldType)
        return typeof formatted === 'string' ? formatted : null
      }
      const raw = extractValue(value as TypedFieldValue)
      return typeof raw === 'object' ? null : String(raw)
    }
    // Arrays (multi-value) or other objects: avoid "[object Object]"
    if (typeof value === 'object') return null
    return String(value)
  }, [value, fieldType])

  // Show skeleton while loading and no value yet — mirror the loaded layout: a
  // record-icon-sized square (RecordIcon size='xs' → size-4 rounded-md) plus the
  // display-name bar, with the same gap/padding/min-height so there's no layout shift.
  if (isResolving && value === undefined) {
    return (
      <div className='flex items-center gap-2 min-h-9 pl-3 pr-2'>
        <Skeleton className='size-4 shrink-0 rounded-md' />
        <Skeleton className='h-4 w-32' />
      </div>
    )
  }

  return (
    <PrimaryCell
      value={displayValue}
      onTitleClick={onTitleClick}
      prefixIcon={
        <RecordIcon
          avatarUrl={record?.avatarUrl}
          iconId={resource?.icon || 'circle'}
          color={resource?.color || 'gray'}
          size='xs'
          inverse
        />
      }
      suffix={
        <ConnectorSourceBadge sources={record?.sources} variant='icon' className='shrink-0' />
      }>
      {children}
    </PrimaryCell>
  )
})
