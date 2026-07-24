// apps/web/src/components/fields/displays/display-relationship.tsx

import {
  extractRelationshipRecordIds,
  getRelationshipRedactedCount,
} from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useRelationship } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { RestrictedRelationshipChip } from '~/components/resources/ui/restricted-relationship-chip'
import { type ItemsListItem, ItemsListView } from '~/components/ui/items-list-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/** Relationship item for ItemsListView (recordId null = redaction marker). */
interface RelationshipItem extends ItemsListItem {
  recordId: RecordId | null
  redactedCount?: number
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
  // Redaction count (v2 Phase 5 §2) — referenced records the member can't view.
  const redactedCount = useMemo(() => getRelationshipRedactedCount(value), [value])

  // Hydrate items via global store for copy text
  const { items } = useRelationship(recordIds)

  // Build relationship items for ItemsListView, appending the redaction marker.
  const relationshipItems = useMemo<RelationshipItem[]>(() => {
    const built: RelationshipItem[] = recordIds.map((recordId) => ({
      id: recordId,
      recordId,
    }))
    if (redactedCount > 0) {
      built.push({ id: '__redacted__', recordId: null, redactedCount })
    }
    return built
  }, [recordIds, redactedCount])

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
        renderItem={(item) => {
          // ItemsListView widens items to `T | string | number`; ours are always
          // RelationshipItem objects — narrow before reading fields.
          if (typeof item !== 'object') return null
          return item.redactedCount ? (
            <RestrictedRelationshipChip count={item.redactedCount} />
          ) : (
            <RecordBadge recordId={item.recordId} />
          )
        }}
      />
    </DisplayWrapper>
  )
}
