// apps/extension/src/iframe/routes/company-route.tsx

import { RecordEmbed } from '../components/record-embed'
import type { Route } from './types'

type Props = Extract<Route, { kind: 'company' }>

/**
 * Company detail route — same shape as ContactRoute, just typed against the
 * `company` route variant. The embed iframe handles identity + open-in-app.
 */
export function CompanyRoute({ recordId }: Props) {
  return <RecordEmbed recordId={recordId} />
}
