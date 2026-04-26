// apps/extension/src/iframe/routes/contact-route.tsx

import { RecordEmbed } from '../components/record-embed'
import type { Route } from './types'

type Props = Extract<Route, { kind: 'contact' }>

/**
 * Contact detail route. Mounts an `<iframe src="/embed/record/...">` that
 * hosts the same `PropertyProvider` / `PropertyRow` editing surface the web
 * sidebar uses — drag-and-drop and edit mode aside. The iframe also renders
 * the identity header + "Open in Auxx" CTA, so the extension wrapper stays
 * empty.
 */
export function ContactRoute({ recordId }: Props) {
  return <RecordEmbed recordId={recordId} />
}
