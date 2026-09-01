// apps/web/src/app/(protected)/app/vendor-bills/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Vendor Bills import page with URL-based step routing.
 */
export default async function VendorBillsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='vendor_bill'
      resourceLabel='Vendor Bills'
      basePath='/app/vendor-bills'
      importBasePath='/app/vendor-bills/import'
      jobId={jobId}
    />
  )
}
