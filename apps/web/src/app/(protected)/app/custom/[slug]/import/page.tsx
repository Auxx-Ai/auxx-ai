// apps/web/src/app/(protected)/app/custom/[slug]/import/page.tsx

import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

/**
 * Custom entity import entry point.
 * Redirects to the upload step for a new import.
 */
export default async function CustomEntityImportPage({ params }: PageProps) {
  const { slug } = await params
  redirect(`/app/custom/${slug}/import/new?step=upload`)
}
