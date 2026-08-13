// packages/lib/src/message-trigger-conditions/types.ts

import type { ParticipantRole } from '@auxx/database/types'

/**
 * The minimal participant shape the evaluator reads — structurally compatible
 * with `Participant` (`@auxx/database/types`), so `context.message.from` from
 * the trigger node's `ProcessedMessage` passes through unchanged.
 */
export interface MessageConditionParticipant {
  identifier?: string | null
  name?: string | null
}

/**
 * The minimal `MessageParticipant` join-row shape the evaluator reads —
 * structurally compatible with `ProcessedMessageParticipant`
 * (`workflow-engine/types/message.ts`).
 */
export interface MessageConditionMessageParticipant {
  role: ParticipantRole | string
  participant?: MessageConditionParticipant | null
}

/**
 * The minimal message shape `evaluateMessageConditions` needs.
 *
 * Deliberately structural rather than importing `ProcessedMessage` from
 * `workflow-engine/types/message.ts`: this module evaluates conditions for
 * one message and has no other reason to depend on the workflow engine's
 * type graph. `context.message` in `trigger-nodes/message-received.ts`
 * satisfies this shape as-is.
 */
export interface MessageConditionInput {
  from?: MessageConditionParticipant | null
  participants?: MessageConditionMessageParticipant[] | null
  subject?: string | null
  textPlain?: string | null
  textHtml?: string | null
  hasAttachments?: boolean | null
}
