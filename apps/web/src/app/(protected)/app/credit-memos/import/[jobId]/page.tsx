// apps/web/src/app/(protected)/app/credit-memos/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Credit Memos import page with URL-based step routing.
 */
export default async function CreditMemosImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='credit_memo'
      resourceLabel='Credit Memos'
      basePath='/app/credit-memos'
      importBasePath='/app/credit-memos/import'
      jobId={jobId}
    />
  )
}
