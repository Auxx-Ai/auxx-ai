// apps/extension/src/iframe/routes/company-route.tsx

import { RecordDetailSkeleton } from '../components/record-detail-skeleton'
import { BASE_URL } from '../trpc'
import { useRecordFetch } from './contact-route'
import { instanceIdFromRecordId, type Route } from './types'

type Props = Extract<Route, { kind: 'company' }>

/**
 * Read-only company detail skeleton — same shape as ContactRoute, just
 * routes to the `companies` deep link.
 */
export function CompanyRoute({ recordId }: Props) {
  const state = useRecordFetch(recordId)
  const openHref = `${BASE_URL}/app/companies/${instanceIdFromRecordId(recordId)}`
  return <RecordDetailSkeleton state={state} openHref={openHref} />
}
