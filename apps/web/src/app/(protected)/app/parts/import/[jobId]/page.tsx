// apps/web/src/app/(protected)/app/parts/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Parts import page with URL-based step routing.
 */
export default async function PartsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='part'
      resourceLabel='Parts'
      basePath='/app/parts'
      importBasePath='/app/parts/import'
      jobId={jobId}
    />
  )
}
