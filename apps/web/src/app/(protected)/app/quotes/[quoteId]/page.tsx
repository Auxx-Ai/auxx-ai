// apps/web/src/app/(protected)/app/quotes/[quoteId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ quoteId: string }> }

/**
 * Quote detail page using the universal DetailView component (money MQ1 build
 * spec §H.4) — the `companies/[companyId]` recipe. `quote` is the first pure
 * `EntityInstance` system def with `hasDetailPage: true` (§A).
 */
async function QuoteDetailPage({ params }: Props) {
  const { quoteId } = await params
  return <DetailView apiSlug='quote' instanceId={quoteId} backUrl='/app/quotes' />
}

export default QuoteDetailPage
