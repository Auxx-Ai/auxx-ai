// apps/web/src/app/(protected)/app/purchase-orders/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Purchase Orders import page with URL-based step routing.
 */
export default async function PurchaseOrdersImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='purchase_order'
      resourceLabel='Purchase Orders'
      basePath='/app/purchase-orders'
      importBasePath='/app/purchase-orders/import'
      jobId={jobId}
    />
  )
}
