// apps/web/src/components/accounting/ui/ledger/work-items-section.tsx

'use client'

import { workItemStatus } from '@auxx/lib/accounting/work-items/client'
import { Section } from '@auxx/ui/components/section'
import { CircleAlert } from 'lucide-react'
import { EntryBlockers, type WorkItemForBlocker, workItemBlocker } from './entry-blockers'
import { formatAuditTimestamp } from './format'

/** A work item as a drawer reads it off the router. */
export interface DrawerWorkItem extends WorkItemForBlocker {
  id: string
  stage: string
  attempts: number
  nextAttemptAt: Date | null
  updatedAt: Date
}

const STAGE_LABEL: Record<string, string> = {
  evidence: 'Waiting on its source evidence',
  money: 'Waiting on its money',
  post: 'Not posted',
  issue: 'Not issued',
}

function scheduleLine(item: DrawerWorkItem, bookTimeZone: string): string {
  const status = workItemStatus(item.reasonCode)
  const tried = `${item.attempts} ${item.attempts === 1 ? 'attempt' : 'attempts'}`
  if (status === 'skipped' || status === 'rejected' || !item.nextAttemptAt)
    return `${tried}, last ${formatAuditTimestamp(item.updatedAt.toISOString(), bookTimeZone)}`
  return `${tried}, next ${formatAuditTimestamp(item.nextAttemptAt.toISOString(), bookTimeZone)}`
}

/** Why a record is parked, one card per work item, rendered from its code (91 §4.6). */
export function WorkItemsSection({
  items,
  bookTimeZone,
}: {
  items: DrawerWorkItem[]
  bookTimeZone: string
}) {
  if (items.length === 0) return null
  return (
    <Section
      title='Why it is waiting'
      icon={<CircleAlert className='size-4' />}
      description='Fix the cause and it is retried; Retry makes it due now.'
      collapsible={false}>
      <div className='flex flex-col gap-3'>
        {items.map((item) => (
          <div key={item.id} className='flex flex-col gap-1'>
            <span className='text-muted-foreground text-xs'>
              {STAGE_LABEL[item.stage] ?? item.stage} - {scheduleLine(item, bookTimeZone)}
            </span>
            <EntryBlockers blockers={[workItemBlocker(item)]} />
          </div>
        ))}
      </div>
    </Section>
  )
}
