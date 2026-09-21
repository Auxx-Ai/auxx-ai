// apps/web/src/app/(protected)/app/vendor-credits/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Vendor Credits import page with URL-based step routing.
 */
export default async function VendorCreditsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='vendor_credit'
      resourceLabel='Vendor Credits'
      basePath='/app/vendor-credits'
      importBasePath='/app/vendor-credits/import'
      jobId={jobId}
    />
  )
}
