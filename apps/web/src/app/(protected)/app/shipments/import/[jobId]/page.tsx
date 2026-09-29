// apps/web/src/app/(protected)/app/shipments/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Shipments import page with URL-based step routing.
 */
export default async function ShipmentsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='shipment'
      resourceLabel='Shipments'
      basePath='/app/shipments'
      importBasePath='/app/shipments/import'
      jobId={jobId}
    />
  )
}
