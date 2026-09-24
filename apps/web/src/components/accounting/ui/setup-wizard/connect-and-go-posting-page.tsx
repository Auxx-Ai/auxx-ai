// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-posting-page.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { Send } from 'lucide-react'
import { ExportAvenuesTable } from '../settings/export-avenues-table'
import type { ConnectAndGoFlow } from './use-connect-and-go'

/** Which posted entries send to the provider on their own; saved on Finish. */
export function ConnectAndGoPostingPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { draft, patchDraft } = flow
  return (
    <Section
      title='Posting'
      className='[&_[data-slot=section]]:border-b-0'
      description={`Auto-send on: a posted entry goes to ${providerLabel} on its own. Off: it waits in the outbox for you to release it.`}
      icon={<Send className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <ExportAvenuesTable
        draft={draft.exportSettings}
        patch={(values) => patchDraft({ exportSettings: { ...draft.exportSettings, ...values } })}
      />
    </Section>
  )
}
