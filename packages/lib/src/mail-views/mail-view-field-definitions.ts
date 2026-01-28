// packages/lib/src/mail-views/mail-view-field-definitions.ts

// NOTE: This file is used on both client and server.
// Only import from client-safe paths.
import { BaseType } from '../workflow-engine/types'
import { FieldType } from '@auxx/database/enums'
import type { Operator } from '../conditions/operator-definitions'

/**
 * Field definition for mail view filters.
 * Compatible with ConditionProvider's FieldDefinition interface.
 */
export interface MailViewFieldDefinition {
  id: string
  label: string
  type: BaseType
  fieldType?: typeof FieldType[keyof typeof FieldType]
  operators?: Operator[]
  options?: Array<{ label: string; value: string }>
  targetTable?: string
  placeholder?: string
  description?: string
}

/**
 * Field definitions for mail view filters.
 * Defines all filterable fields for threads in mail views.
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
    targetTable: 'Tag',
    operators: ['in', 'not in', 'empty', 'not empty'],
    placeholder: 'Select tags...',
    description: 'Filter by tags applied to threads',
  },
  {
    id: 'label',
    label: 'Label',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    targetTable: 'Label',
    operators: ['in', 'not in', 'empty', 'not empty'],
    placeholder: 'Select labels...',
    description: 'Filter by labels on threads',
  },
  {
    id: 'assignee',
    label: 'Assignee',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    targetTable: 'TeamMember',
    operators: ['is', 'is not', 'in', 'not in', 'empty', 'not empty'],
    placeholder: 'Select assignees...',
    description: 'Filter by assigned team member',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    targetTable: 'Inbox',
    operators: ['is', 'is not', 'in', 'not in', 'empty', 'not empty'],
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
    operators: ['is', 'is not', 'contains', 'not contains', 'empty', 'not empty'],
    placeholder: 'Email address...',
    description: 'Filter by sender email address',
  },
  {
    id: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    operators: ['is', 'is not', 'contains', 'not contains', 'empty', 'not empty'],
    placeholder: 'Subject text...',
    description: 'Filter by thread subject',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS FIELD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    operators: ['is', 'is not'],
    options: [
      { label: 'Open', value: 'OPEN' },
      { label: 'Archived', value: 'ARCHIVED' },
      { label: 'Trash', value: 'TRASH' },
      { label: 'Spam', value: 'SPAM' },
    ],
    description: 'Filter by thread status',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DATE FIELD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'date',
    label: 'Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    operators: ['before', 'after', 'on', 'empty', 'not empty'],
    placeholder: 'Select date...',
    description: 'Filter by date',
  },
]

/**
 * Get field definition by ID.
 */
export function getMailViewFieldDefinition(fieldId: string): MailViewFieldDefinition | undefined {
  return MAIL_VIEW_FIELD_DEFINITIONS.find(f => f.id === fieldId)
}

/**
 * Get all available mail view fields.
 */
export function getMailViewFields(): MailViewFieldDefinition[] {
  return MAIL_VIEW_FIELD_DEFINITIONS
}

/**
 * Get default operator for a field.
 */
export function getDefaultOperatorForField(fieldId: string): Operator {
  const field = getMailViewFieldDefinition(fieldId)
  if (!field || !field.operators || field.operators.length === 0) {
    return 'is'
  }
  return field.operators[0]
}
