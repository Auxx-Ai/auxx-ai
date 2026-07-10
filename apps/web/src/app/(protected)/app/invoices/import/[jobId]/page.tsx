// apps/web/src/app/(protected)/app/invoices/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Invoice import page with URL-based step routing.
 */
export default async function InvoicesImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='invoice'
      resourceLabel='Invoices'
      basePath='/app/invoices'
      importBasePath='/app/invoices/import'
      jobId={jobId}
    />
  )
}
