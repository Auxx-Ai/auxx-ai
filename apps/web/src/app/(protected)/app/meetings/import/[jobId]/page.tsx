// apps/web/src/app/(protected)/app/meetings/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

/**
 * Route params for the Meeting import page.
 */
interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Meeting import page with URL-based step routing.
 */
export default async function MeetingsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId='meeting'
      resourceLabel='Meetings'
      basePath='/app/meetings'
      importBasePath='/app/meetings/import'
      jobId={jobId}
    />
  )
}
