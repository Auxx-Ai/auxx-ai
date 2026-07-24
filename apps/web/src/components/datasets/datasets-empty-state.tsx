// apps/web/src/components/datasets/shared/datasets-empty-state.tsx

'use client'

import type { DatasetStatus } from '@auxx/lib/datasets'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Database } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { useAccess } from '~/providers/capabilities-provider'
import { CreateDatasetButton } from './create-dataset-button'

interface DatasetsEmptyStateProps {
  searchQuery: string
  selectedStatus: DatasetStatus | 'all'
}

/**
 * Empty state component for when no datasets are found
 */
export function DatasetsEmptyState({ searchQuery, selectedStatus }: DatasetsEmptyStateProps) {
  const { can } = useAccess()
  const canCreate = can(PermissionKey.datasetsManage)
  const hasFilters = searchQuery || selectedStatus !== 'all'

  if (hasFilters) {
    return (
      <EmptyState
        icon={Database}
        title='No datasets found'
        description="Try adjusting your search terms or filters to find what you're looking for."
      />
    )
  }

  // Members without the create (Full) rung can't add datasets — don't invite
  // them to. The Create button already self-hides on the same gate.
  return (
    <EmptyState
      icon={Database}
      title='No datasets yet'
      description={
        canCreate
          ? 'Create your first dataset to get started with knowledge management.'
          : 'No datasets have been shared with you yet. Ask an admin to add one or share one with you.'
      }
      button={canCreate ? <CreateDatasetButton variant='outline' /> : undefined}
    />
  )
}
