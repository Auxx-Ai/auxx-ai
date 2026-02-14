// packages/lib/src/tasks/config/filter-fields.ts

import type { FieldType } from '@auxx/database/types'
import type { SelectOption } from '@auxx/types/custom-field'
import { BaseType } from '../../workflow-engine/core/types'

/**
 * Filter field IDs for task filtering.
 * Used for validation on both client and server.
 */
export const TASK_FILTER_FIELD_IDS = [
  'assignee',
  'linkedEntity',
  'createdBy',
  'status',
  'priority',
  'deadline',
  'deadlinePeriod',
] as const

export type TaskFilterFieldId = (typeof TASK_FILTER_FIELD_IDS)[number]

/**
 * Field definition interface for task filters.
 */
export interface TaskFilterFieldDefinition {
  id: TaskFilterFieldId
  label: string
  type: BaseType
  fieldType: FieldType
  operators: string[]
  fieldReference?: string
  description: string
  options?: SelectOption[]
}

/**
 * Field definitions for task filtering.
 * Shared between frontend (condition builder) and backend (validation).
 */
export const TASK_FILTER_FIELDS: TaskFilterFieldDefinition[] = [
  {
    id: 'assignee',
    label: 'Assignee',
    type: BaseType.RELATION,
    fieldType: 'RELATIONSHIP',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    fieldReference: 'user:assignee',
    description: 'Filter by assigned team member',
  },
  {
    id: 'linkedEntity',
    label: 'Linked Record',
    type: BaseType.RELATION,
    fieldType: 'RELATIONSHIP',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    fieldReference: 'entity:reference',
    description: 'Filter by linked entity',
  },
  {
    id: 'createdBy',
    label: 'Created By',
    type: BaseType.RELATION,
    fieldType: 'RELATIONSHIP',
    operators: ['in', 'not_in'],
    fieldReference: 'user:createdBy',
    description: 'Filter by task creator',
  },
  {
    id: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    operators: ['equals', 'not_equals', 'in'],
    options: [
      { label: 'Open', value: 'open' },
      { label: 'Completed', value: 'completed' },
      { label: 'Archived', value: 'archived' },
    ],
    description: 'Filter by task status',
  },
  {
    id: 'priority',
    label: 'Priority',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    operators: ['equals', 'not_equals', 'in', 'is_empty'],
    options: [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
    description: 'Filter by priority level',
  },
  {
    id: 'deadline',
    label: 'Due Date',
    type: BaseType.DATETIME,
    fieldType: 'DATETIME',
    operators: ['equals', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
    description: 'Filter by exact due date',
  },
  {
    id: 'deadlinePeriod',
    label: 'Due Date Period',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    operators: ['equals', 'in'],
    options: [
      { label: 'Overdue', value: 'overdue' },
      { label: 'Today', value: 'today' },
      { label: 'Tomorrow', value: 'tomorrow' },
      { label: 'This Week', value: 'this-week' },
      { label: 'Upcoming', value: 'upcoming' },
      { label: 'No Due Date', value: 'no-date' },
    ],
    description: 'Filter by due date period',
  },
]

/**
 * Get a filter field definition by ID.
 */
export function getTaskFilterField(id: string): TaskFilterFieldDefinition | undefined {
  return TASK_FILTER_FIELDS.find((f) => f.id === id)
}

/**
 * Validate that a field ID is a valid task filter field.
 */
export function isValidTaskFilterFieldId(id: string): id is TaskFilterFieldId {
  return TASK_FILTER_FIELD_IDS.includes(id as TaskFilterFieldId)
}
