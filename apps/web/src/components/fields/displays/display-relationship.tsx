// apps/web/src/components/fields/displays/display-relationship.tsx

import { useMemo } from 'react'
import { usePropertyContext } from '../property-provider'
import { useRelationship } from '~/components/resources'
import { extractRelationshipResourceIds } from '@auxx/lib/field-values/client'
import DisplayWrapper from './display-wrapper'
import { ItemsListView, type ItemsListItem } from '~/components/ui/items-list-view'
import { ResourceBadge } from '~/components/resources/ui/resource-badge'
import type { ResourceId } from '@auxx/lib/resources/client'

/** Relationship item for ItemsListView */
interface RelationshipItem extends ItemsListItem {
  resourceId: ResourceId
}

/**
 * Display component for RELATIONSHIP field type
 * Renders related entities using ResourceBadge component
 * Extracts relatedEntityDefinitionId from TypedFieldValue for hydration
 */
export function DisplayRelationship() {
  const { value } = usePropertyContext()

  // Extract ResourceIds using centralized utility
  const resourceIds = useMemo(() => extractRelationshipResourceIds(value), [value])

  // Hydrate items via global store for copy text
  const { items } = useRelationship(resourceIds)

  // Build relationship items for ItemsListView
  const relationshipItems = useMemo<RelationshipItem[]>(() => {
    return resourceIds.map((resourceId) => ({
      id: resourceId,
      resourceId,
    }))
  }, [resourceIds])

  // Build display names for copy value
  const copyText = items.map((item) => item?.displayName ?? '').filter(Boolean).join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <ItemsListView
        items={relationshipItems}
        emptyContent={<span className="text-muted-foreground">-</span>}
        renderItem={(item) => <ResourceBadge resourceId={item.resourceId} />}
      />
    </DisplayWrapper>
  )
}
