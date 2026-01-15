// apps/web/src/app/(protected)/app/tickets/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Ticket import page with URL-based step routing.
 */
export default async function TicketsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId="ticket"
      resourceLabel="Tickets"
      basePath="/app/tickets"
      importBasePath="/app/tickets/import"
      jobId={jobId}
    />
  )
}
