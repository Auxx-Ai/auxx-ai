// apps/web/src/components/favorites/ui/items/entity-instance-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useResource } from '~/components/resources/hooks/use-resource'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

interface RecordMeta {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
}

export function EntityInstanceItem({ favorite }: { favorite: FavoriteEntity<'ENTITY_INSTANCE'> }) {
  const entityDefinitionId = favorite.targetIds?.entityDefinitionId ?? ''
  const entityInstanceId = favorite.targetIds?.entityInstanceId ?? ''
  const recordId =
    entityDefinitionId && entityInstanceId ? toRecordId(entityDefinitionId, entityInstanceId) : null

  const { record, isLoading, isNotFound } = useRecord<RecordMeta>({ recordId })
  const { resource } = useResource(entityDefinitionId || null)
  const href = useRecordLink(recordId)

  if (!recordId) return null
  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !record || !resource || !href) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={
        <RecordIcon
          iconId={resource.icon}
          color={resource.color}
          avatarUrl={record.avatarUrl ?? undefined}
          size='xs'
        />
      }
      title={record.displayName ?? 'Untitled'}
      subtitle={resource.label}
      href={href}
    />
  )
}
