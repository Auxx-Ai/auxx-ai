// apps/web/src/components/datasets/datasets-grid-view.tsx

'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useListSelection } from '~/components/list-selection'
import { DatasetCard } from './dataset-card'
import { useDatasets } from './datasets-provider'

/**
 * Grid view component for displaying datasets as cards
 */
export function DatasetsGridView() {
  const { items, refetch } = useDatasets()
  const router = useRouter()
  const setItemIds = useListSelection((s) => s.setItemIds)

  useEffect(() => {
    setItemIds(items.map((d) => d.id))
  }, [items, setItemIds])

  /**
   * Navigate to dataset detail page
   */
  const handleDatasetClick = (datasetId: string) => {
    router.push(`/app/datasets/${datasetId}`)
  }

  return (
    <div className='grid gap-4 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4'>
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
