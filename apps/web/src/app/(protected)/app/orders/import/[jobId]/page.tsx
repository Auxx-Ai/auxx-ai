// apps/web/src/app/(protected)/app/orders/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Orders import page with URL-based step routing.
 */
export default async function OrdersImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='order'
      resourceLabel='Orders'
      basePath='/app/orders'
      importBasePath='/app/orders/import'
      jobId={jobId}
    />
  )
}
