// apps/web/src/app/(protected)/app/quotes/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Quote import page with URL-based step routing.
 */
export default async function QuotesImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='quote'
      resourceLabel='Quotes'
      basePath='/app/quotes'
      importBasePath='/app/quotes/import'
      jobId={jobId}
    />
  )
}
