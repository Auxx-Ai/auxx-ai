// apps/web/src/components/datasets/datasets-grid-view.tsx

'use client'

import { useRouter } from 'next/navigation'
import { DatasetCard } from './dataset-card'
import { useDatasets } from './datasets-provider'

/**
 * Grid view component for displaying datasets as cards
 */
export function DatasetsGridView() {
  const { items, refetch } = useDatasets()
  const router = useRouter()

  /**
   * Navigate to dataset detail page
   */
  const handleDatasetClick = (datasetId: string) => {
    router.push(`/app/datasets/${datasetId}`)
  }

  return (
    <div className='grid gap-4 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4 p-3'>
      {items.map((dataset) => (
        <DatasetCard
          key={dataset.id}
          dataset={dataset}
          onClick={() => handleDatasetClick(dataset.id)}
          onActionComplete={refetch}
        />
      ))}
    </div>
  )
}
