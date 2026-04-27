// apps/web/src/components/favorites/ui/items/workflow-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { Workflow } from 'lucide-react'
import { useFavoriteWorkflow } from '../../hooks/use-favorite-workflow'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function WorkflowItem({ favorite }: { favorite: FavoriteEntity<'WORKFLOW'> }) {
  const ids = favorite.targetIds
  const { workflow, isLoading, isNotFound } = useFavoriteWorkflow(ids?.workflowId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !workflow) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<Workflow />}
      title={workflow.name ?? 'Untitled workflow'}
      subtitle='Workflow'
      href={`/app/workflows/${workflow.id}`}
    />
  )
}
