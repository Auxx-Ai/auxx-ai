// apps/web/src/app/(protected)/app/work-orders/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Work order import page with URL-based step routing.
 */
export default async function WorkOrdersImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='work_order'
      resourceLabel='Work Orders'
      basePath='/app/work-orders'
      importBasePath='/app/work-orders/import'
      jobId={jobId}
    />
  )
}
