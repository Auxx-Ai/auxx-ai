// packages/lib/src/message-trigger-conditions/client.ts
// Client-safe entry point for message-trigger conditions — the condition-editor
// field catalog for the MESSAGE_RECEIVED trigger. No database/server imports.
//
// NOTE: no 'use client' directive. Server code imports this file too (the
// engine's evaluate.ts and the trigger node's config validation), and the
// directive would turn every export into a client-reference proxy there.

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../workflow-engine/types'

/**
 * Field definition for a MESSAGE_RECEIVED trigger condition.
 * Compatible with ConditionProvider's FieldDefinition interface — same shape
 * as `MailViewFieldDefinition` (`mail-views/mail-view-field-definitions.ts`)
 * so the shared condition-builder UI can render either catalog, but this one
 * is message-scoped rather than thread/SQL-oriented and is NOT derived from
 * `MAIL_VIEW_FIELD_DEFINITIONS`.
 */
export interface MessageConditionFieldDefinition {
  id: string
  label: string
  type: BaseType
  fieldType: (typeof FieldType)[keyof typeof FieldType]
  placeholder?: string
  description?: string
}

/**
 * The condition-editor field catalog for a MESSAGE_RECEIVED trigger.
 *
 * Deliberately excludes two fields a message trigger could otherwise offer
 * (plan `2026-08-12-message-trigger-scoping-and-send-safety.md` §3):
 * - `channel` — owned by the trigger's scope picker (§4); a condition here
 *   would duplicate that boundary.
 * - `isInbound` — always true once the dispatcher gates the publish (§6);
 *   dead weight as a condition.
 *
 * `to` resolves to every TO participant's address at evaluation time
 * (`evaluate.ts`), not a single value — the shared operator evaluator already
 * fans a positive/negated operator over an array, so `to contains "@x.com"`
 * behaves as expected without a special "any of" operator.
 */
export const MESSAGE_CONDITION_FIELD_DEFINITIONS: MessageConditionFieldDefinition[] = [
  {
    id: 'from',
    label: 'From',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    placeholder: 'Sender email...',
    description: "The message sender's email address",
  },
  {
    id: 'to',
    label: 'To',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    placeholder: 'Recipient email...',
    description: 'A recipient email address on the message',
  },
  {
    id: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'Subject text...',
    description: 'The message subject line',
  },
  {
    id: 'body',
    label: 'Body',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'Body text...',
    description: 'The message body content',
  },
  {
    id: 'hasAttachments',
    label: 'Has Attachments',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    description: 'Whether the message has one or more attachments',
  },
]

/** Get all available message-condition fields. */
export function getMessageConditionFields(): MessageConditionFieldDefinition[] {
  return MESSAGE_CONDITION_FIELD_DEFINITIONS
}

/** Look up one message-condition field by id; undefined when unknown. */
export function getMessageConditionField(
  fieldId: string
): MessageConditionFieldDefinition | undefined {
  return MESSAGE_CONDITION_FIELD_DEFINITIONS.find((f) => f.id === fieldId)
}
