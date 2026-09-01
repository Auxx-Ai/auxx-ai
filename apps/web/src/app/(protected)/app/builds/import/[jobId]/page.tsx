// apps/web/src/app/(protected)/app/builds/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Builds import page with URL-based step routing.
 */
export default async function BuildsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='build'
      resourceLabel='Builds'
      basePath='/app/builds'
      importBasePath='/app/builds/import'
      jobId={jobId}
    />
  )
}
