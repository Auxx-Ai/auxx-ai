// apps/web/src/app/(protected)/app/companies/[companyId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ companyId: string }> }

/**
 * Company detail page using the universal DetailView component
 */
async function CompanyDetailPage({ params }: Props) {
  const { companyId } = await params
  return <DetailView apiSlug='company' instanceId={companyId} />
}

export default CompanyDetailPage
