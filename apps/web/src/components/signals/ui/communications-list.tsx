// apps/web/src/components/signals/ui/communications-list.tsx
'use client'

// CommunicationsList — the shared "what have we already sent this customer?" timeline
// (client-notifications plan §4.8/Phase 4). Renders `EntitySignal` rows (newest first) for a
// set of `recordKeys`: sequence-driven sends (visit reminders, en-route, follow-ups, invoice
// reminders) AND manual quote/invoice sends — both write through the same `recordSignal()`
// choke point, so this view is honest about both. Reused by the job detail section, the job
// drawer's compact card, and the contact detail section.

import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { formatDistanceToNow } from 'date-fns'
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  Receipt,
  Truck,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ComponentType } from 'react'
import { useRecordSignals } from '~/components/signals/hooks/use-record-signals'
import type { RouterOutputs } from '~/trpc/react'

type SignalRow = RouterOutputs['signal']['listForRecordKeys'][number]

/** `sequence_step` signals' `metadata.templateKey` → the seeded sequences (plan §4.6). Falls
 * back to a generic label for org-created sequences (no stable templateKey). */
const SEQUENCE_TEMPLATE_LABELS: Record<string, string> = {
  visit_reminders: 'Visit reminder',
  visit_en_route: 'On our way',
  job_follow_up: 'Job follow-up',
  invoice_reminders: 'Invoice reminder',
  visit_follow_up: 'Visit follow-up',
}

const SEQUENCE_TEMPLATE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  visit_reminders: CalendarClock,
  visit_en_route: Truck,
  job_follow_up: CheckCircle2,
  invoice_reminders: Receipt,
  visit_follow_up: CheckCircle2,
}

function metadataOf(signal: SignalRow): Record<string, unknown> {
  return (signal.metadata as Record<string, unknown> | null) ?? {}
}

/** Human label for a signal row — the communications-timeline "what happened" text. */
function labelForSignal(signal: SignalRow): string {
  const metadata = metadataOf(signal)
  if (signal.subtype === 'document_send') {
    if (metadata.documentType === 'invoice') return 'Invoice sent'
    if (metadata.documentType === 'quote') return 'Quote sent'
    return 'Document sent'
  }
  if (signal.subtype === 'sequence_step') {
    const templateKey = typeof metadata.templateKey === 'string' ? metadata.templateKey : undefined
    return (templateKey && SEQUENCE_TEMPLATE_LABELS[templateKey]) || 'Automated message'
  }
  return 'Message sent'
}

function iconForSignal(signal: SignalRow): ComponentType<{ className?: string }> {
  const metadata = metadataOf(signal)
  if (signal.subtype === 'document_send') {
    return metadata.documentType === 'invoice' ? Receipt : FileText
  }
  if (signal.subtype === 'sequence_step') {
    const templateKey = typeof metadata.templateKey === 'string' ? metadata.templateKey : undefined
    return (templateKey && SEQUENCE_TEMPLATE_ICONS[templateKey]) || Mail
  }
  return Mail
}

function recipientOf(signal: SignalRow): string | undefined {
  const metadata = metadataOf(signal)
  return typeof metadata.recipientEmail === 'string' ? metadata.recipientEmail : undefined
}

export interface CommunicationsListProps {
  /** `toSignalRecordKey(...)`-shaped strings, e.g. `['work_order:<id>', 'visit:<id>']`. */
  recordKeys: string[]
  /** Caps the returned rows — pass a small number for a compact drawer card. */
  limit?: number
  emptyTitle?: string
  emptyDescription?: string
}

/** Shared "what have we already sent this customer?" timeline over one or more record keys. */
export function CommunicationsList({
  recordKeys,
  limit,
  emptyTitle = 'No communications yet',
  emptyDescription = 'Sent emails and automated reminders will show up here.',
}: CommunicationsListProps) {
  const router = useRouter()
  const { data: signals, isLoading } = useRecordSignals(recordKeys, { limit })

  if (isLoading) return <EmptySection loading />

  if (!signals?.length) {
    return (
      <EmptySection
        icon={<Mail className='size-5' />}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div className='flex flex-col'>
      {signals.map((signal) => {
        const Icon = iconForSignal(signal)
        const recipient = recipientOf(signal)
        return (
          <TreeRow
            key={signal.id}
            icon={<Icon className='size-4' />}
            title={<span className='truncate text-sm'>{labelForSignal(signal)}</span>}
            secondary={<span className='truncate text-muted-foreground'>{signal.title}</span>}
            actions={
              <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                {recipient && <span className='max-w-40 truncate'>{recipient}</span>}
                <span className='shrink-0 tabular-nums'>
                  {formatDistanceToNow(new Date(signal.occurredAt), { addSuffix: true })}
                </span>
                {signal.threadId && (
                  <TreeRowButton
                    tooltipText='Open thread'
                    onClick={() => router.push(`/app/mail/inbox/open/${signal.threadId}`)}>
                    <ExternalLink />
                  </TreeRowButton>
                )}
              </div>
            }
          />
        )
      })}
    </div>
  )
}
