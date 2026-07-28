// apps/web/src/components/datasets/ui/dataset-breadcrumb-switcher.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo } from 'react'
import { EntityBreadcrumbSwitcher, type EntitySwitcherItem } from '~/components/pickers'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** The list caps at the schema max; anything beyond it is reported honestly. */
const LIST_LIMIT = 100

interface DatasetBreadcrumbSwitcherProps {
  /** The dataset currently open — highlighted in the list. */
  activeDatasetId: string
  /** Trigger label — the active dataset's name. */
  activeLabel: React.ReactNode
}

/**
 * The dataset switcher mounted in the dataset detail breadcrumb — search, jump,
 * favorite, open settings, and delete, over every dataset the member may view.
 *
 * `limit: 100` is passed explicitly: `listDatasetsSchema` caps there but
 * *defaults* to 20, so relying on the default truncates the list to a fifth of
 * the real ceiling. When the router still reports `hasMore` the truncation is
 * stated rather than hidden.
 *
 * Settings and delete are the `admin` rung of per-dataset instance access and
 * are gated per row.
 */
export function DatasetBreadcrumbSwitcher({
  activeDatasetId,
  activeLabel,
}: DatasetBreadcrumbSwitcherProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const { canAdminInstance } = useAccess()

  const { data, isLoading } = api.dataset.list.useQuery(
    { limit: LIST_LIMIT },
    { staleTime: 30_000 }
  )

  const deleteDataset = api.dataset.delete.useMutation({
    onSuccess: () => void utils.dataset.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to delete dataset', description: error.message }),
  })

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      (data?.datasets ?? []).map((dataset) => ({
        id: dataset.id,
        label: dataset.name,
        href: `/app/datasets/${dataset.id}`,
        iconId: 'database',
      })),
    [data]
  )

  const canAdmin = (item: EntitySwitcherItem) => canAdminInstance(toRecordId('dataset', item.id))

  return (
    <EntityBreadcrumbSwitcher<'DATASET'>
      activeLabel={activeLabel}
      items={items}
      activeId={activeDatasetId}
      isLoading={isLoading}
      searchPlaceholder='Search datasets...'
      emptyText='No datasets'
      onSelect={(item) => router.push(item.href ?? '/app/datasets')}
      canEdit={canAdmin}
      onEdit={(item) => router.push(`/app/datasets/${item.id}?tab=settings`)}
      canDelete={canAdmin}
      deleteConfirm={(item) => ({
        title: 'Delete Dataset',
        description: `Are you sure you want to permanently delete "${item.label}"? This action cannot be undone and will remove all associated documents and data.`,
      })}
      onDelete={async (item) => {
        await deleteDataset.mutateAsync({ id: item.id })
        if (item.id === activeDatasetId) router.push('/app/datasets')
      }}
      favorite={{ targetType: 'DATASET', targetIds: (item) => ({ datasetId: item.id }) }}
      truncatedNotice={
        data?.hasMore ? `Showing the first ${LIST_LIMIT} — refine your search` : undefined
      }
    />
  )
}
