// apps/web/src/app/(protected)/app/datasets/[datasetId]/page.tsx

'use client'

import { use } from 'react'
import { DatasetDetailContent } from './_components/dataset-detail-content'
import { DatasetDetailProvider } from './_components/dataset-detail-provider'

interface DatasetPageProps {
  params: Promise<{ datasetId: string }>
}

export default function DatasetPage({ params }: DatasetPageProps) {
  const { datasetId } = use(params)

  return (
    <DatasetDetailProvider datasetId={datasetId}>
      <DatasetDetailContent />
    </DatasetDetailProvider>
  )
}
