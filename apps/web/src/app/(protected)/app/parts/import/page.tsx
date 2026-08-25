// apps/web/src/app/(protected)/app/parts/import/page.tsx

import { redirect } from 'next/navigation'

interface PageProps {
  searchParams: Promise<{ target?: string }>
}

/**
 * Parts import entry point.
 *
 * Redirects to the upload step for a new import, preserving the named-importer
 * `target` so *Import supplier prices* lands on the right def rather than parts.
 * The param is forwarded verbatim in whatever form it arrived — `[jobId]/page.tsx`
 * owns resolving and canonicalizing it (`resolve-target.ts`), so there is one
 * place that knows the accepted forms.
 */
export default async function PartsImportPage({ searchParams }: PageProps) {
  const { target } = await searchParams
  const query = target ? `&target=${encodeURIComponent(target)}` : ''
  redirect(`/app/parts/import/new?step=upload${query}`)
}
