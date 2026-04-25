// apps/extension/src/iframe/routes/company-route.tsx

import { RecordEmbed } from '../components/record-embed'
import { BASE_URL } from '../trpc'
import { useRecordFetch } from './contact-route'
import { instanceIdFromRecordId, type Route } from './types'

type Props = Extract<Route, { kind: 'company' }>

/**
 * Company detail route — same shape as ContactRoute, just routes to the
 * `companies` deep link.
 */
export function CompanyRoute({ recordId }: Props) {
  const state = useRecordFetch(recordId)
  const openHref = `${BASE_URL}/app/companies/${instanceIdFromRecordId(recordId)}`
  const displayName = state.status === 'ready' ? (state.record.displayName ?? null) : null

  if (state.status === 'loading') {
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  }
  if (state.status === 'error') {
    return <p className='text-sm text-destructive'>{state.message}</p>
  }

  return <RecordEmbed recordId={recordId} openHref={openHref} displayName={displayName} />
}
