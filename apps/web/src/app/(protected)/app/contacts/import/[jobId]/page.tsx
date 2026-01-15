// apps/web/src/app/(protected)/app/contacts/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
}

/**
 * Contact import page with URL-based step routing.
 */
export default async function ContactsImportStepPage({ params }: PageProps) {
  const { jobId } = await params

  return (
    <ImportPage
      entityDefinitionId="contact"
      resourceLabel="Contacts"
      basePath="/app/contacts"
      importBasePath="/app/contacts/import"
      jobId={jobId}
    />
  )
}
