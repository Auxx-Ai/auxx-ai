// apps/web/src/app/(protected)/app/parts/import/[jobId]/page.tsx

import { redirect } from 'next/navigation'
import { ImportPage } from '~/components/data-import/import-page'
import { resolveNamedImporterTarget } from './resolve-target'

interface PageProps {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ target?: string; step?: string }>
}

/** The resource whose page hosts these importers. */
const HOST_DEF_ID = 'part'

/**
 * Parts import page with URL-based step routing.
 *
 * Hosts the NAMED IMPORTERS too (`?target=part_vendor_parts`): the join defs are
 * hidden, so they have no records page of their own to run an import from, and
 * parts is where their importers live.
 *
 * The canonical `target` is the declaring FIELD KEY, but a def id or CUID is
 * accepted and normalized — see {@link resolveNamedImporterTarget}. 🛑 A target
 * that resolves to nothing falls back to `part` rather than being trusted: the
 * param must never be a way to start a job against a def the menu never offered.
 */
export default async function PartsImportStepPage({ params, searchParams }: PageProps) {
  const { jobId } = await params
  const { target, step } = await searchParams

  const resolved = await resolveNamedImporterTarget(HOST_DEF_ID, target)

  // Speak ONE language downstream. A target that arrived in a non-canonical form
  // is rewritten to the field key before the wizard sees it, so every in-wizard
  // URL, every step navigation and every reload carries the same string.
  if (resolved.importer && resolved.canonicalized) {
    const stepQuery = step ? `?step=${encodeURIComponent(step)}&` : '?'
    redirect(`/app/parts/import/${jobId}${stepQuery}target=${resolved.importer.fieldKey}`)
  }

  return (
    <ImportPage
      entityDefinitionId={resolved.importer?.entityDefinitionId ?? HOST_DEF_ID}
      resourceLabel='Parts'
      importTitle={resolved.importer?.label}
      basePath='/app/parts'
      importBasePath='/app/parts/import'
      // 🛑 The KEY, never the def id — this is what every in-wizard URL carries and
      // what the resolver matches on first.
      importTarget={resolved.importer?.fieldKey}
      jobId={jobId}
    />
  )
}
