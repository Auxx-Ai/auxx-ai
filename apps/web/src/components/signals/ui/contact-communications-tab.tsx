// apps/web/src/components/signals/ui/contact-communications-tab.tsx
'use client'

// ContactCommunicationsTab — registered as `contact:communications` (client-notifications plan
// §4.8/Phase 4). Same `CommunicationsList` the job detail page uses, over a single
// `contact:<id>` record key — cheap since `listSignalsForRecordKeys` is one query shape
// regardless of how many keys are passed.

import type { DetailViewTabProps } from '~/components/detail-view'
import { CommunicationsList } from './communications-list'

export function ContactCommunicationsTab({ entityInstanceId }: DetailViewTabProps) {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <CommunicationsList recordKeys={[`contact:${entityInstanceId}`]} />
    </div>
  )
}

export default ContactCommunicationsTab
