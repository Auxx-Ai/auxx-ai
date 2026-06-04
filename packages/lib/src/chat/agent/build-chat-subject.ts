// packages/lib/src/chat/agent/build-chat-subject.ts

import { toRecordId } from '@auxx/types/resource'
import type { Subject } from '../../ai/agent-framework/tool-context'

/**
 * Verified-passport inputs the chat subject is built from. Sourced at the chat
 * boundary (the per-request-verified passport) and threaded onto the chat-turn
 * job — the worker never sees the passport itself, so the route hands these
 * down. See plans/chat/v8 phase-1.
 */
export interface ChatSubjectInput {
  /** The chat `Thread` this turn runs on. Always present. */
  threadId: string
  /**
   * The `Participant` that sent the inbound message that kicked off this turn
   * (the verified passport's `visitorParticipantId`). Always present, incl. an
   * anonymous sender.
   */
  participantId: string
  /**
   * The verified contact `EntityInstance.id`, baked into the passport at mint
   * **only** when a cryptographically-verified user JWT resolved it. `null`
   * otherwise (anonymous, or an unverified soft-hint link).
   */
  contactId: string | null
  /** `true` only when the passport was minted with a valid customer JWT. */
  identityVerified: boolean
  /** Untrusted `identify()` claim — display only, never an anchor. */
  claimed?: { name?: string; email?: string }
}

/**
 * The **sole producer** of a chat `Subject` (plans/chat/v8 phase-1, trust
 * invariant). Encodes the invariant structurally rather than in prose:
 *
 * - `thread` + `participant` anchors are always set (incl. an anonymous sender).
 * - `contact` is added **only** when the passport was crypto-verified AND a
 *   `contactId` was baked in. A spoofable `identify()` claim lands in `claimed`,
 *   which is not an anchor, so a forged email can never select a record.
 *
 * Because this is the only writer of `anchors.contact` + `identityVerified`, a
 * future dev cannot wire `contact` from a user-supplied email without going
 * through this gate.
 */
export function buildChatSubjectFromPassport(input: ChatSubjectInput): Subject {
  const verified = input.identityVerified && input.contactId != null

  const subject: Subject = {
    anchors: {
      thread: toRecordId('thread', input.threadId),
      participant: toRecordId('participant', input.participantId),
      ...(verified ? { contact: toRecordId('contact', input.contactId as string) } : {}),
    },
    identityVerified: verified,
  }
  if (input.claimed && (input.claimed.name || input.claimed.email)) {
    subject.claimed = input.claimed
  }
  return subject
}
