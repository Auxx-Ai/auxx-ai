// apps/web/src/app/(protected)/app/companies/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Company import page with URL-based step routing.
 */
export default async function CompaniesImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='company'
      resourceLabel='Companies'
      basePath='/app/companies'
      importBasePath='/app/companies/import'
      jobId={jobId}
    />
  )
}
