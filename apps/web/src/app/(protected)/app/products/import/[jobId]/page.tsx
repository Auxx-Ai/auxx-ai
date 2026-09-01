// apps/web/src/app/(protected)/app/products/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Products import page with URL-based step routing.
 */
export default async function ProductsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='product'
      resourceLabel='Products'
      basePath='/app/products'
      importBasePath='/app/products/import'
      jobId={jobId}
    />
  )
}
