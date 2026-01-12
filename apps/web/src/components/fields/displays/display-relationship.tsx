// apps/web/src/components/fields/displays/display-relationship.tsx

import { useMemo } from 'react'
import { usePropertyContext } from '../property-provider'
import { useRelationship } from '~/components/resources'
import { extractRelationshipResourceIds, getInstanceId } from '@auxx/lib/field-values/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import DisplayWrapper from './display-wrapper'
import { ItemsListView, type ItemsListItem } from '~/components/ui/items-list-view'

/** Relationship item for ItemsListView */
interface RelationshipItem extends ItemsListItem {
  displayName: string
  avatarUrl?: string | null
  isLoaded: boolean
}

/**
 * Display component for RELATIONSHIP field type
 * Renders related entities as badges with avatar and name
 * Extracts relatedEntityDefinitionId from TypedFieldValue for hydration
 */
export function DisplayRelationship() {
  const { value } = usePropertyContext()

  // Extract ResourceIds using centralized utility
  const resourceIds = useMemo(() => extractRelationshipResourceIds(value), [value])

  // Hydrate items via global store
  const { items, isLoading } = useRelationship(resourceIds)

  // Build relationship items for ItemsListView
  const relationshipItems = useMemo<RelationshipItem[]>(() => {
    return resourceIds.map((resourceId, idx) => {
      const entity = items[idx]
      const instanceId = getInstanceId(resourceId)
      return {
        id: instanceId,
        displayName: entity?.displayName ?? `${instanceId.slice(0, 8)}...`,
        avatarUrl: entity?.avatarUrl,
        isLoaded: !!entity,
      }
    })
  }, [resourceIds, items])

  // Build display names for copy value
  const copyText = relationshipItems.map((item) => item.displayName).join(', ')

  // Show loading skeleton when data is loading and no items are cached yet
  if (isLoading && items.every((i) => i === undefined)) {
    return (
      <DisplayWrapper copyValue={null}>
        {resourceIds.map((resourceId) => (
          <Skeleton key={resourceId} className="h-5 w-20 rounded-full" />
        ))}
      </DisplayWrapper>
    )
  }

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <ItemsListView
        items={relationshipItems}
        emptyContent={<span className="text-muted-foreground">-</span>}
        renderItem={(item) =>
          item.isLoaded ? (
            <Badge variant="pill" shape="tag" className="flex items-center gap-1.5">
              {item.avatarUrl && (
                <Avatar className="size-4">
                  <AvatarImage src={item.avatarUrl} />
                  <AvatarFallback className="text-[10px]">{item.displayName?.[0]}</AvatarFallback>
                </Avatar>
              )}
              <span>{item.displayName}</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {item.displayName}
            </Badge>
          )
        }
      />
    </DisplayWrapper>
  )
}
