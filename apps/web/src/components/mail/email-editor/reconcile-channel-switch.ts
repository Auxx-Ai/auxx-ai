// apps/web/src/components/mail/email-editor/reconcile-channel-switch.ts

import type { ComposerCapabilities } from '@auxx/lib/channels/client'
import type { IdentifierModelSpec } from './identifier-model'
import type { RecipientState, Recipients } from './types'

/**
 * The parts of the composer's draft a From switch can invalidate.
 *
 * `attachmentCount` rather than the attachments themselves: attachments live in
 * two places (persisted rows + in-flight uploads) and clearing them is the
 * caller's job — this function only decides *whether* they must go.
 */
export interface ChannelSwitchDraft {
  recipients: Recipients
  subject: string
  signatureId: string | null
  attachmentCount: number
}

export interface ChannelSwitchOutcome {
  recipients: Recipients
  subject: string
  signatureId: string | null
  /** True when the incoming channel cannot carry attachments and some exist. */
  clearAttachments: boolean
  /**
   * Human-readable fragments naming what was removed, e.g.
   * `['3 recipients', 'the subject']`. Empty when the switch was lossless.
   */
  dropped: string[]
}

interface PartitionResult {
  kept: RecipientState[]
  dropped: number
}

/**
 * Keep the recipients the INCOMING channel can actually address, dropping the
 * rest. Survivors are rewritten to the incoming model's canonical form and
 * `identifierType` — carrying an `EMAIL` identifierType into an SMS send would
 * mis-route the participant lookup.
 */
function partition(list: RecipientState[], spec: IdentifierModelSpec): PartitionResult {
  const kept: RecipientState[] = []
  let dropped = 0
  for (const recipient of list) {
    const normalized = spec.normalize(recipient.identifier)
    if (!normalized) {
      dropped += 1
      continue
    }
    kept.push({ ...recipient, identifier: normalized, identifierType: spec.identifierType })
  }
  return { kept, dropped }
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`

/**
 * Reconcile an in-progress draft against the capabilities of the channel the
 * user just switched From to.
 *
 * The bug this exists for: `subject`, `cc`/`bcc`, `signatureId` and attachments
 * are merely *hidden* when the target channel can't carry them — they stay in
 * component state and are still submitted by the send handler. Everything here
 * therefore returns cleared VALUES, not render flags.
 *
 * Drop-and-warn by design: a contact picked by name often has both an email and
 * a phone, so re-resolving the person against the target model would preserve
 * more — that is a deliberate follow-up, not v1.
 *
 * @param spec Identifier model of the INCOMING channel (`getIdentifierModel`).
 */
export function reconcileDraftForChannel({
  draft,
  incoming,
  spec,
}: {
  draft: ChannelSwitchDraft
  incoming: ComposerCapabilities
  spec: IdentifierModelSpec
}): ChannelSwitchOutcome {
  const to = partition(draft.recipients.TO, spec)
  // Cc/Bcc go wholesale when the target has no concept of them; otherwise they
  // face the same identifier partition as To.
  const cc = incoming.ccBcc
    ? partition(draft.recipients.CC, spec)
    : { kept: [], dropped: draft.recipients.CC.length }
  const bcc = incoming.ccBcc
    ? partition(draft.recipients.BCC, spec)
    : { kept: [], dropped: draft.recipients.BCC.length }

  const droppedSubject = !incoming.subject && draft.subject.trim().length > 0
  const droppedSignature = !incoming.signature && draft.signatureId !== null
  const clearAttachments = !incoming.attachments && draft.attachmentCount > 0

  const droppedRecipients = to.dropped + cc.dropped + bcc.dropped
  const dropped: string[] = []
  if (droppedRecipients > 0) dropped.push(plural(droppedRecipients, 'recipient', 'recipients'))
  if (droppedSubject) dropped.push('the subject')
  if (droppedSignature) dropped.push('the signature')
  if (clearAttachments) {
    dropped.push(plural(draft.attachmentCount, 'attachment', 'attachments'))
  }

  return {
    recipients: { TO: to.kept, CC: cc.kept, BCC: bcc.kept },
    subject: incoming.subject ? draft.subject : '',
    signatureId: incoming.signature ? draft.signatureId : null,
    clearAttachments,
    dropped,
  }
}

/** `['a', 'b', 'c']` → `'a, b and c'`. */
export function formatDroppedList(dropped: string[]): string {
  if (dropped.length <= 1) return dropped[0] ?? ''
  return `${dropped.slice(0, -1).join(', ')} and ${dropped[dropped.length - 1]}`
}
