// apps/web/src/components/drawers/cards/thread-visit-card.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Section } from '@auxx/ui/components/section'
import { MessageSquare } from 'lucide-react'
import EntityFields from '~/components/fields/entity-fields'
import { asChatThreadMetadata } from '~/components/mail/chat-thread-metadata'
import { useParticipant, useThread } from '~/components/threads/hooks'
import { useDrawerContext } from '../drawer-context'

/** The FieldValue-backed thread visit fields, in display order. */
const VISIT_KEYS = [
  'visitUrl',
  'visitReferrer',
  'visitUserAgent',
  'visitIp',
  'visitCity',
  'visitRegion',
  'visitCountry',
  'visitTimezone',
]

interface ThreadVisitCardProps {
  /** Contact instance id when rendered inside a contact drawer. */
  contactInstanceId?: string
  /** Participant id when rendered inside a participant (anonymous) drawer. */
  participantId?: string
}

/**
 * "This conversation" card — the visit facts of the active chat thread,
 * rendered through the standard `EntityFields` Details surface pointed at the
 * thread record. Self-gating: returns `null` unless the ambient drawer context
 * is a chat thread AND this drawer's subject is that thread's visitor.
 */
export function ThreadVisitCard({ contactInstanceId, participantId }: ThreadVisitCardProps) {
  const ctx = useDrawerContext()
  const threadId = ctx?.kind === 'thread' && ctx.channel === 'chat' ? ctx.threadId : null

  const { thread } = useThread({ threadId: threadId ?? '', enabled: !!threadId })
  const visitorPid = asChatThreadMetadata(thread?.metadata)?.visitorParticipantId ?? null

  // Resolve the thread's visitor participant only when we need its linked
  // contact id (contact-drawer match). For the participant drawer we match the
  // participant id directly without a fetch.
  const { participant: visitor } = useParticipant({
    participantId: contactInstanceId ? visitorPid : null,
    enabled: !!contactInstanceId && !!visitorPid,
  })

  if (!threadId || !visitorPid) return null

  const matches = participantId
    ? visitorPid === participantId
    : !!contactInstanceId && visitor?.entityInstanceId === contactInstanceId
  if (!matches) return null

  return (
    <Section
      title='This conversation'
      initialOpen
      collapsible={false}
      icon={<MessageSquare className='size-4' />}>
      <EntityFields recordId={toRecordId('thread', threadId)} includeFields={VISIT_KEYS} readOnly />
    </Section>
  )
}

export default ThreadVisitCard
