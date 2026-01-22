// apps/web/src/app/(protected)/app/custom/[slug]/[id]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ slug: string; id: string }> }

/**
 * Custom entity detail page
 * Uses the universal DetailView component
 */
async function CustomEntityDetailPage({ params }: Props) {
  const { slug, id } = await params

  return <DetailView apiSlug={slug} instanceId={id} />
}

export default CustomEntityDetailPage
