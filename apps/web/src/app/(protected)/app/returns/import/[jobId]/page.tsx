// apps/web/src/app/(protected)/app/returns/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Returns import page with URL-based step routing.
 */
export default async function ReturnsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='return'
      resourceLabel='Returns'
      basePath='/app/returns'
      importBasePath='/app/returns/import'
      jobId={jobId}
    />
  )
}
