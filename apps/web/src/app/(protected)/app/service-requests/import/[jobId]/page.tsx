// apps/web/src/app/(protected)/app/service-requests/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Service request import page with URL-based step routing.
 */
export default async function ServiceRequestsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='service_request'
      resourceLabel='Service Requests'
      basePath='/app/service-requests'
      importBasePath='/app/service-requests/import'
      jobId={jobId}
    />
  )
}
