// apps/web/src/app/(protected)/app/parcels/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Parcels import page with URL-based step routing.
 */
export default async function ParcelsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='parcel'
      resourceLabel='Parcels'
      basePath='/app/parcels'
      importBasePath='/app/parcels/import'
      jobId={jobId}
    />
  )
}
