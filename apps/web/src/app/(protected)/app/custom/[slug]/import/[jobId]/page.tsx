// apps/web/src/app/(protected)/app/custom/[slug]/import/[jobId]/page.tsx

import { ImportPage } from '~/components/data-import/import-page'
import { api } from '~/trpc/server'
import { notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string; jobId: string }>
}

/**
 * Custom entity import page with URL-based step routing.
 */
export default async function CustomEntityImportStepPage({ params }: PageProps) {
  const { slug, jobId } = await params

  // Fetch entity definition to get the label
  const entityDefinition = await api.entityDefinition.getBySlug({ slug }).catch(() => null)

  if (!entityDefinition) {
    notFound()
  }

  return (
    <ImportPage
      targetTable={`entity_${slug}`}
      resourceLabel={entityDefinition.plural}
      basePath={`/app/custom/${slug}`}
      importBasePath={`/app/custom/${slug}/import`}
      jobId={jobId}
    />
  )
}
