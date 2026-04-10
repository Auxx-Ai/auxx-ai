// apps/web/src/app/(protected)/app/parts/[partId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ partId: string }> }

/**
 * Part detail page using the universal DetailView component
 */
async function PartDetailPage({ params }: Props) {
  const { partId } = await params

  return <DetailView apiSlug='part' instanceId={partId} />
}

export default PartDetailPage
