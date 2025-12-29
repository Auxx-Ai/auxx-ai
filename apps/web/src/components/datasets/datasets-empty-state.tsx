// apps/web/src/components/datasets/shared/datasets-empty-state.tsx

'use client'

import { EmptyState } from '~/components/global/empty-state'
import { CreateDatasetButton } from './create-dataset-button'
import type { DatasetStatus } from '@auxx/lib/datasets'
import { Database } from 'lucide-react'

interface DatasetsEmptyStateProps {
  searchQuery: string
  selectedStatus: DatasetStatus | 'all'
}

/**
 * Empty state component for when no datasets are found
 */
export function DatasetsEmptyState({ searchQuery, selectedStatus }: DatasetsEmptyStateProps) {
  const hasFilters = searchQuery || selectedStatus !== 'all'

  if (hasFilters) {
    return (
      <EmptyState
        icon={Database}
        title="No datasets found"
        description="Try adjusting your search terms or filters to find what you're looking for."
      />
    )
  }

  return (
    <EmptyState
      icon={Database}
      title="No datasets yet"
      description="Create your first dataset to get started with knowledge management."
      button={<CreateDatasetButton variant="outline" />}
    />
  )
}
