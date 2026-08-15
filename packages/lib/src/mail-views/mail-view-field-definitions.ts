// packages/lib/src/mail-views/mail-view-field-definitions.ts

import { FieldType } from '@auxx/database/enums'
import { toResourceFieldId } from '@auxx/types/field'
import { CHANNEL_GROUP_OPTIONS } from '../channels/capabilities'
import { getOperatorsForFieldType, type Operator } from '../conditions/operator-definitions'
import type { FieldOptions } from '../custom-fields/field-options'
// NOTE: This file is used on both client and server.
// Only import from client-safe paths.
import { BaseType } from '../workflow-engine/types'

/**
 * Field definition for mail view filters.
 * Compatible with ConditionProvider's FieldDefinition interface.
 *
 * NOTE: operators are derived from fieldType using getOperatorsForFieldType()
 * - Use getDefaultOperatorForField() to get the first valid operator
 * - Use getOperatorsForFieldType(field.fieldType) to get all valid operators
 */
export interface MailViewFieldDefinition {
  id: string
  label: string
  type: BaseType
  fieldType: (typeof FieldType)[keyof typeof FieldType]
  /** Field-specific options using unified FieldOptions type */
  options?: FieldOptions
  placeholder?: string
  description?: string
}

/** Reserved fieldId for the search scope condition */
export const SEARCH_SCOPE_FIELD_ID = 'searchScope'

/** Check if a condition is the search scope condition */
export function isSearchScopeCondition(condition: { fieldId: string }): boolean {
  return condition.fieldId === SEARCH_SCOPE_FIELD_ID
}

/**
 * Search scope field definition.
 * Not included in the main array — only used for field resolution in ConditionBadge.
 */
export const SEARCH_SCOPE_FIELD_DEFINITION: MailViewFieldDefinition = {
  id: SEARCH_SCOPE_FIELD_ID,
  label: 'Scope',
  type: BaseType.STRING,
  fieldType: 'SCOPE' as any,
  description: 'Search scope — this mailbox or everywhere',
}

/**
 * Field definitions for mail view filters.
 * Defines all filterable fields for threads in mail views.
 *
 * NOTE: operators are automatically derived from fieldType using getOperatorsForFieldType()
 */
export const MAIL_VIEW_FIELD_DEFINITIONS: MailViewFieldDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // ENTITY REFERENCE FIELDS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'tag',
    label: 'Tag',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    options: {
      relationship: {
        inverseResourceFieldId: toResourceFieldId('tag', 'threads'),
        relationshipType: 'has_many',
        isInverse: false,
      },
    },
    placeholder: 'Select tags...',
    description: 'Filter by tags applied to threads',
  },
  {
    id: 'assignee',
    label: 'Assignee',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    options: {
      actor: {
        target: 'user',
        multiple: false,
      },
    },
    placeholder: 'Select assignees...',
    description: 'Filter by assigned team member',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    options: {
      relationship: {
        // Named to match the thread resource's own `inbox` relation
        // (`resources/registry/resources/thread-fields.ts`) — `'inbox:threads'`
        // pointed at a third, differently-spelled inverse that never existed.
        // Neither half resolves (there is no inverse field on either inbox
        // definition) and this array is not part of the resource registry, so
        // only the LEFT half is ever read: `getRelatedEntityDefinitionId` uses
        // it to scope this filter's record picker.
        //
        // The SAVED-FILTER QUERY is definition-agnostic and stays that way:
        // `mail-query/condition-query-builder.ts` `buildInboxQuery` strips any
        // RecordId prefix and matches bare `Thread.inboxId` values, so threads
        // in a `personal_inbox` mailbox never drop out of a saved view.
        // Known gap (phase-3 UI sweep, plan 40a §7): the PICKER above is scoped
        // to this one slug, so personal mailboxes stop being *selectable* here
        // once data migration 060 moves them — `MailViewFieldDefinition` has no
        // `dynamicOptionsKey`, which is how the thread field's picker unions
        // both definitions.
        inverseResourceFieldId: toResourceFieldId('inbox', 'inbox_threads'),
        relationshipType: 'has_many',
        isInverse: false,
      },
    },
    placeholder: 'Select inboxes...',
    description: 'Filter by inbox',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT FIELDS
  // ═══════════════════════════════════════════════════════════════════════════
  // `sender` / `from` / `to` are ADDRESS fields, not email fields. All three
  // compile to `ilike(Participant.identifier, …)`, and that column is
  // polymorphic — an email address, an E.164 phone number, a Facebook PSID or a
  // chat-visitor id — so `from is +15102055536` is as valid as
  // `from is ada@acme.com`. One field per concept, never one per channel
  // (plans/mail-filter/09-channel-aware-filters-plan.md D1): the searchbar,
  // mail views and filters share this catalog because they share one evaluator,
  // and splitting `from` into three would fork that language where the SQL has
  // one column.
  //
  // `type` is STRING rather than EMAIL for exactly that reason. `fieldType`
  // STAYS `FieldType.EMAIL`: it is what routes the value input to
  // `ParticipantPicker` (which searches identifiers of every type) instead of an
  // `<input type="email">` that rejects a phone number, and its operator set is
  // fully dispatched by `buildParticipantIdentifierQuery`.
  {
    id: 'sender',
    label: 'Sender',
    type: BaseType.STRING,
    fieldType: FieldType.EMAIL,
    // Same `participantType` as `from` — the two ids compile to the identical
    // `role = 'FROM'` predicate, so they must offer the identical input.
    options: { email: { participantType: 'from' } },
    placeholder: 'Email, phone number or handle...',
    description: 'Filter by the sender’s address on any channel',
  },
  {
    id: 'from',
    label: 'From',
    type: BaseType.STRING,
    fieldType: FieldType.EMAIL,
    options: { email: { participantType: 'from' } },
    placeholder: 'Email, phone number or handle...',
    description: 'Filter by the sender’s address on any channel',
  },
  {
    id: 'to',
    label: 'To',
    type: BaseType.STRING,
    fieldType: FieldType.EMAIL,
    options: { email: { participantType: 'to' } },
    placeholder: 'Email, phone number or handle...',
    description: 'Filter by a recipient’s address on any channel',
  },
  {
    id: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'Subject text...',
    description: 'Filter by thread subject',
  },
  {
    id: 'body',
    label: 'Body',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'Body text...',
    description: 'Filter by email body content',
  },
  // `list` and `senderDomain` are backed by the `Message.listId` /
  // `Message.senderDomain` columns derived at ingest (suggestions plan §1.1).
  // Both are `FieldType.TEXT`, which advertises the full string operator set —
  // `is` / `is not` / `contains` / `not contains` / `starts with` / `ends with` /
  // `in` / `not in` / `empty` / `not empty`. `buildListQuery` /
  // `buildSenderDomainQuery` handle **every one of them**, and
  // `mail-query/__tests__/condition-query-builder.test.ts` pins that parity: a
  // field that offers an operator the builder can't dispatch compiles to the bare
  // org scope and matches the whole mailbox (mail-filters invariant 19).
  {
    id: 'list',
    label: 'Mailing list',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'news.acme.com',
    description: 'Filter by the mailing list (List-Id) a message was sent to',
  },
  {
    id: 'senderDomain',
    label: 'Sender domain',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'acme.com',
    description: 'Filter by the registrable domain of the sender address',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS FIELD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    options: {
      options: [
        { value: 'unassigned', label: 'Unassigned' },
        { value: 'assigned', label: 'Assigned' },
        { value: 'done', label: 'Done' },
        { value: 'trash', label: 'Trash' },
        { value: 'spam', label: 'Spam' },
      ],
    },
    description: 'Filter by thread status',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANNEL FIELD
  // ═══════════════════════════════════════════════════════════════════════════
  // The only way to say "when a new SMS arrives in this inbox" on a MIXED
  // inbox. An inbox is a union of channel types, not one type — "Shared Inbox"
  // carries a `google` and an `email` channel, "Chat Support" a `chat` and a
  // `google` one — and a channel can be attached AFTER a filter is written. So
  // channel-awareness is expressed as a CONDITION the author writes, never as a
  // catalog partition frozen at authoring time (plan 09 D2).
  //
  // Options are the coarse groups declared on `PLATFORM_CAPABILITIES`, not raw
  // providers (plan 09 D3 + Q1): `Integration` rows are re-minted on reconnect
  // and `google`/`outlook`/`imap`/`mailgun` are all just "Email" to the author.
  {
    id: 'channelType',
    label: 'Channel',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    options: { options: CHANNEL_GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
    description: 'Filter by the channel a conversation arrived on',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DATE FIELDS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'date',
    label: 'Sent Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    placeholder: 'Select date...',
    description: 'Filter by date',
  },
  // {
  //   id: 'before',
  //   label: 'Before',
  //   type: BaseType.DATE,
  //   fieldType: FieldType.DATE,
  //   placeholder: 'Select date...',
  //   description: 'Filter messages before date',
  // },
  // {
  //   id: 'after',
  //   label: 'After',
  //   type: BaseType.DATE,
  //   fieldType: FieldType.DATE,
  //   placeholder: 'Select date...',
  //   description: 'Filter messages after date',
  // },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOLEAN FIELDS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'hasAttachments',
    label: 'Has Attachments',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    description: 'Filter by attachment presence',
  },
  {
    id: 'sharedWithMe',
    label: 'Shared with me',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    description: 'Threads explicitly shared with you',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FREE TEXT FIELD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'freeText',
    label: 'Search',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    placeholder: 'Search text...',
    description: 'Free text search across all fields',
  },
]

/**
 * Get field definition by ID.
 */
export function getMailViewFieldDefinition(fieldId: string): MailViewFieldDefinition | undefined {
  if (fieldId === SEARCH_SCOPE_FIELD_ID) return SEARCH_SCOPE_FIELD_DEFINITION
  return MAIL_VIEW_FIELD_DEFINITIONS.find((f) => f.id === fieldId)
}

/**
 * Get all available mail view fields.
 */
export function getMailViewFields(): MailViewFieldDefinition[] {
  return MAIL_VIEW_FIELD_DEFINITIONS
}

/**
 * Get default operator for a field.
 * Derives valid operators from the field's fieldType.
 */
export function getDefaultOperatorForField(fieldId: string): Operator {
  const field = getMailViewFieldDefinition(fieldId)
  if (!field) {
    return 'is'
  }
  // Date fields default to on_date (same-day comparison)
  if (field.fieldType === FieldType.DATE || field.fieldType === FieldType.DATETIME) {
    return 'on_date'
  }
  const operators = getOperatorsForFieldType(field.fieldType)
  if (operators.length === 0) {
    return 'is'
  }
  return (operators[0]?.key ?? 'is') as Operator
}
