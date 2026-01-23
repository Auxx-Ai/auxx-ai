// apps/web/src/components/fields/displays/display-actor.tsx

import { useMemo } from 'react'
import type { ActorId } from '@auxx/types/actor'
import { isActorId, toActorId } from '@auxx/types/actor'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { ItemsListView, type ItemsListItem } from '~/components/ui/items-list-view'

/** Actor item for ItemsListView */
interface ActorItem extends ItemsListItem {
  actorId: ActorId
}

/** Actor value object from formatToRawValue */
interface ActorValueObject {
  actorType: 'user' | 'group'
  id: string
  actorId?: ActorId
}

/**
 * Extract ActorId from various value formats.
 * Handles: ActorId string, { actorId }, { actorType, id }
 */
function extractActorId(val: unknown): ActorId | null {
  if (!val) return null

  // Already an ActorId string
  if (typeof val === 'string' && isActorId(val)) {
    return val as ActorId
  }

  // Object with actorId field
  if (typeof val === 'object' && val !== null) {
    const obj = val as ActorValueObject
    if (obj.actorId && isActorId(obj.actorId)) {
      return obj.actorId
    }
    // Fallback: construct from actorType + id
    if (obj.actorType && obj.id) {
      return toActorId(obj.actorType, obj.id)
    }
  }

  return null
}

/**
 * Display component for ACTOR field type.
 * Renders actor(s) using ActorBadge component.
 * Supports both single ActorId and array of ActorIds.
 */
export function DisplayActor() {
  const { value } = useFieldContext()

  // Normalize value to array of ActorIds
  const actorIds = useMemo<ActorId[]>(() => {
    if (!value) return []

    // Handle array of values
    if (Array.isArray(value)) {
      return value.map(extractActorId).filter((id): id is ActorId => id !== null)
    }

    // Handle single value
    const actorId = extractActorId(value)
    return actorId ? [actorId] : []
  }, [value])

  // Hydrate actors via store for copy text
  const actors = useActors(actorIds)

  // Build actor items for ItemsListView
  const actorItems = useMemo<ActorItem[]>(() => {
    return actorIds.map((actorId) => ({
      id: actorId,
      actorId,
    }))
  }, [actorIds])

  // Build display names for copy value
  const copyText = actorIds
    .map((id) => actors.get(id)?.name ?? '')
    .filter(Boolean)
    .join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <ItemsListView
        items={actorItems}
        emptyContent={<span className="text-muted-foreground">-</span>}
        renderItem={(item) => <ActorBadge actorId={item.actorId} />}
      />
    </DisplayWrapper>
  )
}
