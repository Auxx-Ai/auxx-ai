// apps/web/src/components/signals/ui/work-order-communications-card.tsx
'use client'

// WorkOrderCommunicationsCard — the job drawer's compact "Communications" overview card
// (client-notifications plan §4.8/Phase 4), registered as `work_order:communications`. Same
// `CommunicationsList` as the full detail-page section, capped to a handful of the most recent
// rows — the drawer is a glance, not the full timeline (open the job's detail page for that).

import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { CommunicationsList } from './communications-list'

const DRAWER_CARD_LIMIT = 5

export function WorkOrderCommunicationsCard({ entityInstanceId }: DrawerTabProps) {
  // Visits/invoices aren't resolved here — the compact card only needs the job's own signal
  // links; a signal linked to one of its visits/invoices is still visible on the full detail
  // page's Communications section, which fans out to those record keys too.
  return (
    <CommunicationsList
      recordKeys={[`work_order:${entityInstanceId}`]}
      limit={DRAWER_CARD_LIMIT}
      emptyDescription='Sent emails and automated reminders for this job will show up here.'
    />
  )
}

export default WorkOrderCommunicationsCard
