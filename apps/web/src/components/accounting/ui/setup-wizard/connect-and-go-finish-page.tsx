// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-finish-page.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { Boxes } from 'lucide-react'
import { booksStartDate } from '~/components/accounting/books-start'
import type { ScheduleCadence } from '../provider-sync/provider-sync-schedule-row'
import { ConnectAndGoBacklog } from './connect-and-go-backlog'
import { ConnectAndGoStepList } from './connect-and-go-summary'
import { OpeningInventoryDifference } from './opening-inventory-difference'
import type { ConnectAndGoFlow } from './use-connect-and-go'

const SYNC_SUMMARY: Record<ScheduleCadence, (provider: string) => string> = {
  off: (provider) => `Reads ${provider} only when you press Sync now.`,
  'twice-daily': (provider) => `Reads ${provider} twice a day.`,
  daily: (provider) => `Reads ${provider} daily.`,
}

/**
 * The backlog after the cutover and what each finish step did; Finish is in the shell's
 * footer. After finalize, the opening inventory difference (111 Q19): explicit, never
 * posted by finalize itself.
 */
export function ConnectAndGoFinishPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  const { report, outcome, draft } = flow
  if (!report) return null

  return (
    <div className='flex flex-col'>
      {outcome && <ConnectAndGoStepList report={outcome} providerLabel={providerLabel} />}

      {flow.done ? (
        <>
          <p className='px-4 py-3 text-muted-foreground text-sm'>
            Your opening is posted and the ledger is open. Everything from{' '}
            {booksStartDate(draft.cutoffPeriod)}, when your books start, now posts and exports on
            its own.
          </p>
          <Section
            title='Opening inventory'
            description={`What ${providerLabel} says inventory was worth when your books start, against your counted parts.`}
            icon={<Boxes className='size-4 text-muted-foreground' />}
            collapsible={false}>
            <OpeningInventoryDifference settingsHint />
          </Section>
        </>
      ) : (
        <>
          <ConnectAndGoBacklog
            cutoffPeriod={draft.cutoffPeriod}
            bookTimeZone={draft.bookTimeZone || null}
            exportMode={draft.exportMode}
            providerLabel={providerLabel}
          />
          <p className='px-4 pt-3 text-muted-foreground text-sm'>
            {SYNC_SUMMARY[draft.syncCadence](providerLabel)}
          </p>
          {flow.booksInvalid && (
            <p className='px-4 pt-3 text-muted-foreground text-xs'>{flow.booksInvalid}</p>
          )}
        </>
      )}
    </div>
  )
}
