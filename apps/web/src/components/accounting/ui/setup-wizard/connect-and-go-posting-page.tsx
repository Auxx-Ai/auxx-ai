// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-posting-page.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { RefreshCw, Send } from 'lucide-react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ProviderSyncCadenceSelect } from '../provider-sync/provider-sync-schedule-row'
import { ExportAvenuesTable } from '../settings/export-avenues-table'
import type { ConnectAndGoFlow } from './use-connect-and-go'

/** What auxx sends to the provider and how often it reads back; both saved on Finish. */
export function ConnectAndGoPostingPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { draft, patchDraft } = flow
  return (
    <div className='flex flex-col'>
      <Section
        title='Posting'
        description={`Auto-send on: a posted entry goes to ${providerLabel} on its own. Off: it waits in the outbox for you to release it.`}
        icon={<Send className='size-4 text-muted-foreground' />}
        collapsible={false}>
        <ExportAvenuesTable
          draft={draft.exportSettings}
          patch={(values) => patchDraft({ exportSettings: { ...draft.exportSettings, ...values } })}
        />
      </Section>
      <Section
        title={`Sync from ${providerLabel}`}
        className='[&_[data-slot=section]]:border-b-0'
        description={`Bring the entries your accountant authors in ${providerLabel} into these books.`}
        icon={<RefreshCw className='size-4 text-muted-foreground' />}
        collapsible={false}>
        <FieldPanel className='p-0'>
          <FieldPanelRow
            title='Sync frequency'
            description='Manual only is the default - the first runs against a real company file want a person watching them. Change it later in settings.'>
            <ProviderSyncCadenceSelect
              value={draft.syncCadence}
              onChange={(syncCadence) => patchDraft({ syncCadence })}
            />
          </FieldPanelRow>
        </FieldPanel>
      </Section>
    </div>
  )
}
