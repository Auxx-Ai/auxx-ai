// apps/web/src/app/(protected)/app/parts/import/[jobId]/page.tsx

import { findNamedImporter } from '@auxx/lib/resources'
import { ImportPage } from '~/components/data-import/import-page'

interface PageProps {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ target?: string }>
}

/**
 * Parts import page with URL-based step routing.
 *
 * Hosts the NAMED IMPORTERS too (`?target=vendor_part`): the join defs are hidden,
 * so they have no records page of their own to run an import from, and parts is
 * where their importers live. 🛑 An unrecognised `target` falls back to `part`
 * rather than being trusted — the param must never be a way to start a job against
 * a def the menu never offered.
 */
export default async function PartsImportStepPage({ params, searchParams }: PageProps) {
  const { jobId } = await params
  const { target } = await searchParams

  const namedImporter = target ? findNamedImporter('part', target) : null

  return (
    <ImportPage
      entityDefinitionId={namedImporter?.entityDefinitionId ?? 'part'}
      resourceLabel='Parts'
      importTitle={namedImporter?.label}
      basePath='/app/parts'
      importBasePath='/app/parts/import'
      importTarget={namedImporter?.entityDefinitionId}
      jobId={jobId}
    />
  )
}
