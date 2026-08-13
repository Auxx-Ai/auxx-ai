// packages/lib/src/message-trigger-conditions/evaluate.ts

import { ParticipantRole } from '@auxx/database/enums'
import { type ConditionDiagnostic, evaluateConditionsWithDiagnostics } from '../conditions/evaluate'
import type { ConditionGroup } from '../conditions/types'
import type { MessageConditionInput } from './types'

/** Result of evaluating a MESSAGE_RECEIVED trigger's condition groups against one message. */
export interface MessageConditionEvaluation {
  matched: boolean
  diagnostics: ConditionDiagnostic[]
}

/**
 * Resolve one message-condition field's value off the message.
 *
 * `to` fans out to every TO participant's address rather than resolving a
 * single value — `evaluateOperator` (`conditions/evaluate-operator.ts`)
 * already fans a positive operator over an array (ANY element matches) and a
 * negated one (EVERY element must), so `to contains "@acme.com"` behaves the
 * way an author expects with no special-casing here.
 *
 * An unrecognised `fieldId` resolves to `undefined`, never
 * `FIELD_NOT_RESOLVABLE` — that sentinel means "the server already filtered
 * for this," which is not true of anything reaching this resolver. `undefined`
 * fails every operator naturally (see `evaluateOperator`), which is the
 * correct outcome for a field this catalog doesn't define.
 */
function resolveMessageField(message: MessageConditionInput, fieldId: string): unknown {
  switch (fieldId) {
    case 'from':
      return message.from?.identifier ?? undefined
    case 'to':
      return (message.participants ?? [])
        .filter((p) => p.role === ParticipantRole.TO && !!p.participant?.identifier)
        .map((p) => p.participant?.identifier as string)
    case 'subject':
      return message.subject ?? undefined
    case 'body':
      return message.textPlain || message.textHtml || undefined
    case 'hasAttachments':
      return message.hasAttachments ?? false
    default:
      return undefined
  }
}

/**
 * Evaluate a MESSAGE_RECEIVED trigger's condition groups against one message.
 *
 * `undefined`/empty groups match everything — no conditions configured means
 * the trigger runs on every message, same as today. A condition that could
 * not be evaluated as written (an unrecognised operator, or a `valueSource`
 * placeholder with nothing to resolve it — see
 * {@link evaluateConditionsWithDiagnostics}) fails the WHOLE evaluation rather
 * than being silently dropped: this is the fail-closed replacement for the
 * deleted legacy `applyFilter` `default:` branch, which let an unrecognised
 * filter key pass everything through.
 *
 * Pattern copied from `workflow-engine/nodes/triggers/resource-trigger-base.ts`'s
 * `evaluateTriggerFilters` — the shared evaluator plus a message-specific
 * `FieldResolver`, no private comparison logic here.
 */
export function evaluateMessageConditions(
  message: MessageConditionInput,
  groups: ConditionGroup[] | undefined
): MessageConditionEvaluation {
  if (!groups || groups.length === 0) return { matched: true, diagnostics: [] }

  const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
    message,
    groups,
    resolveMessageField
  )

  return { matched: matched && diagnostics.length === 0, diagnostics }
}
