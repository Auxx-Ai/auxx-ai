// apps/web/src/components/fields/displays/display-relationship.tsx

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useRelationship } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { type ItemsListItem, ItemsListView } from '~/components/ui/items-list-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/** Relationship item for ItemsListView */
interface RelationshipItem extends ItemsListItem {
  recordId: RecordId
}

/**
 * Display component for RELATIONSHIP field type
 * Renders related entities using RecordBadge component
 * Extracts relatedEntityDefinitionId from TypedFieldValue for hydration
 */
export function DisplayRelationship() {
  const { value } = useFieldContext()

  // Extract RecordIds using centralized utility
  const recordIds = useMemo(() => extractRelationshipRecordIds(value), [value])

  // Hydrate items via global store for copy text
  const { items } = useRelationship(recordIds)

  // Build relationship items for ItemsListView
  const relationshipItems = useMemo<RelationshipItem[]>(() => {
    return recordIds.map((recordId) => ({
      id: recordId,
      recordId,
    }))
  }, [recordIds])

  // Build display names for copy value
  const copyText = items
    .map((item) => item?.displayName ?? '')
    .filter(Boolean)
    .join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <ItemsListView
        items={relationshipItems}
        emptyContent={<span className='text-muted-foreground'>-</span>}
        renderItem={(item) => <RecordBadge recordId={item.recordId} />}
      />
    </DisplayWrapper>
  )
}
