// packages/lib/src/mail-views/mail-view-field-definitions.ts

import { FieldType } from '@auxx/database/enums'
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
        inverseResourceFieldId: 'tag:threads',
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
        inverseResourceFieldId: 'inbox:threads',
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
  {
    id: 'sender',
    label: 'Sender',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    placeholder: 'Email address...',
    description: 'Filter by sender email address',
  },
  {
    id: 'from',
    label: 'From',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    placeholder: 'Sender email...',
    description: 'Filter by sender email address',
  },
  {
    id: 'to',
    label: 'To',
    type: BaseType.EMAIL,
    fieldType: FieldType.EMAIL,
    placeholder: 'Recipient email...',
    description: 'Filter by recipient email address',
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
  const operators = getOperatorsForFieldType(field.fieldType)
  if (operators.length === 0) {
    return 'is'
  }
  return operators[0].key as Operator
}
