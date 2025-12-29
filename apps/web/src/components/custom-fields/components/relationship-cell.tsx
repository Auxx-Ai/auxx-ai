// apps/web/src/components/custom-fields/components/relationship-cell.tsx
'use client'

import { memo, useMemo } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { useRelationship } from '~/components/resources'
import { useEntityRecords } from '../context/entity-records-context'
import { ItemsCellView, type ItemsListItem } from '~/components/ui/items-list-view'
import type { RouterOutputs } from '~/trpc/react'

/** Custom field type from API */
type CustomField = RouterOutputs['customField']['getByEntityDefinition'][number]

/**
 * Props for RelationshipCell
 */
interface RelationshipCellProps {
  /** The custom field definition */
  field: CustomField
  /** The field value (array of IDs or wrapped in { data: [...] }) */
  value: unknown
}

/**
 * Relationship item type for use with ItemsCellView
 */
interface RelationshipItem extends ItemsListItem {
  id: string
  displayName: string
  isNotFound: boolean
  truncatedId?: string
}

/**
 * Cell component for rendering relationship field values
 * Uses ItemsCellView for consistent expandable behavior
 */
export const RelationshipCell = memo(function RelationshipCell({
  field,
  value,
}: RelationshipCellProps) {
  const { getResourceIdForField } = useEntityRecords()

  // Extract IDs from value
  const ids = useMemo(() => {
    if (!value) return []
    const data = (value as { data?: string[] })?.data ?? value
    if (Array.isArray(data)) return data
    if (typeof data === 'string') return [data]
    return []
  }, [value])

  // Get resourceId for this field
  const resourceId = useMemo(() => {
    return getResourceIdForField(field)
  }, [field, getResourceIdForField])

  // Fetch/get hydrated data
  const { items: rawItems, isLoading, isComplete } = useRelationship(resourceId, ids)

  // Transform to RelationshipItem array
  const items = useMemo<RelationshipItem[]>(() => {
    return ids.map((id, index) => {
      const item = rawItems[index]
      if (!item) {
        return {
          id: `${id}-${index}`,
          displayName: '',
          isNotFound: true,
          truncatedId: id.slice(-6),
        }
      }
      return {
        id: item.id,
        displayName: item.displayName,
        isNotFound: false,
      }
    })
  }, [ids, rawItems])

  return (
    <ItemsCellView
      items={items}
      isLoading={isLoading && !isComplete}
      loadingCount={Math.min(ids.length || 3, 3)}
      renderItem={(item) => {
        if (item.isNotFound) {
          return (
            <Badge variant="pill" shape="tag" className="text-xs">
              {item.truncatedId ?? '?'}
            </Badge>
          )
        }
        return (
          <Badge variant="pill" shape="tag" className="text-xs">
            {item.displayName}
          </Badge>
        )
      }}
    />
  )
})
