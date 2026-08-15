// apps/web/src/components/threads/utils/thread-title.ts

import { PLATFORM_CAPABILITIES, type PlatformCapabilities } from '@auxx/lib/channels/client'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import type { ParticipantMeta } from '../store'

/**
 * The slice of a participant a thread title needs. Deliberately a `Pick` so any
 * surface holding a full {@link ParticipantMeta} can pass it straight through.
 */
export type ThreadTitleParticipant = Pick<
  ParticipantMeta,
  'name' | 'identifier' | 'identifierType' | 'displayName'
>

/**
 * Whether a channel's threads carry a real subject line.
 *
 * Reads `PlatformCapabilities.subject` — the same flag the composer uses to
 * decide whether to render a subject field. An unknown/absent provider is
 * treated as subject-carrying so email (and anything not yet in the capability
 * map) keeps today's rendering.
 */
export function channelCarriesSubject(provider?: string | null): boolean {
  if (!provider) return true
  const caps = PLATFORM_CAPABILITIES[provider as keyof typeof PLATFORM_CAPABILITIES] as
    | PlatformCapabilities
    | undefined
  return caps?.subject ?? true
}

/**
 * Human-facing rendering of a participant's routing identifier.
 *
 * Phone identifiers are stored as E.164 (`+15102055536`) because
 * `Participant.identifier` is a routing key — this is display only, and goes
 * through the shared `PHONE_INTL` formatter (libphonenumber under the hood)
 * rather than any hand-rolled digit surgery. Chat visitors return `null`: their
 * identifier is an opaque session UUID and the server already renders a
 * friendly handle into `displayName`.
 */
export function formatParticipantIdentifier(
  participant?: ThreadTitleParticipant | null
): string | null {
  const identifier = participant?.identifier?.trim()
  if (!identifier) return null

  if (participant?.identifierType === 'CHAT_VISITOR') return null

  if (participant?.identifierType === 'PHONE') {
    const formatted = formatToDisplayValue({ type: 'text', value: identifier }, 'PHONE_INTL', {
      phoneFormat: 'international',
    })
    return typeof formatted === 'string' && formatted.trim() ? formatted : identifier
  }

  return identifier
}

/** The slice of a participant counterparty selection needs. */
export type ThreadTitleCandidate = ThreadTitleParticipant & Pick<ParticipantMeta, 'isInternal'>

/**
 * The participant a thread should be titled after: the counterparty, never us.
 *
 * `isInternal` only classifies EMAIL identifiers (`_classifyIsInternal` returns
 * false for every phone and chat participant), so on exactly the channels that
 * need a derived title it cannot tell our own number from the customer's. Hence
 * `selfIdentifier` — the sending channel's own address/number — which is the
 * only reliable way to drop ourselves from an outbound-last SMS thread.
 *
 * @param candidates Participants in preference order (FROM, then TO, then CC).
 * @param selfIdentifier The channel's own address/number, if known.
 */
export function pickThreadCounterparty<T extends ThreadTitleCandidate>(
  candidates: readonly (T | undefined)[],
  selfIdentifier?: string | null
): T | undefined {
  const present = candidates.filter((p): p is T => !!p)
  const self = selfIdentifier?.trim().toLowerCase()
  const isSelf = (p: T) => !!self && p.identifier.trim().toLowerCase() === self

  return (
    present.find((p) => !p.isInternal && !isSelf(p)) ??
    present.find((p) => !isSelf(p)) ??
    present[0]
  )
}

export interface ThreadTitleInput {
  /** `Thread.subject` — `''` on channels that genuinely have no subject. */
  subject?: string | null
  /** `Thread.integrationProvider` (an `IntegrationProviderType` value). */
  integrationProvider?: string | null
  /** The thread's counterparty, if one has resolved yet. */
  participant?: ThreadTitleParticipant | null
}

/**
 * Title for a thread, derived at render time — never persisted.
 *
 * A real subject always wins. When a thread has none AND its channel has no
 * concept of one (SMS, WhatsApp, DMs — `PlatformCapabilities.subject === false`),
 * the thread is titled by its participant instead: contact name first, then a
 * formatted identifier.
 *
 * Deliberately NOT written back into `Thread.subject`: that column is a search
 * index (GIN full-text + trigram), and the mail lens grants subject and body
 * visibility separately so a `metadata`-tier viewer can see that a thread
 * exists without reading it. Participant identity is what the `identity` tier
 * already grants, so titling by participant leaks nothing new — pushing a
 * synthetic title into the subject column would leak into both.
 *
 * @returns The title to render, or `null` when the caller should fall back to
 *   its own empty-subject placeholder (every email thread lands here).
 */
export function resolveThreadTitle({
  subject,
  integrationProvider,
  participant,
}: ThreadTitleInput): string | null {
  const trimmedSubject = subject?.trim()
  if (trimmedSubject) return trimmedSubject

  if (channelCarriesSubject(integrationProvider)) return null

  const name = participant?.name?.trim()
  if (name) return name

  const identifier = formatParticipantIdentifier(participant)
  if (identifier) return identifier

  return participant?.displayName?.trim() || null
}
