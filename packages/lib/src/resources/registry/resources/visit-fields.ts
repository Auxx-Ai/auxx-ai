// packages/lib/src/resources/registry/resources/visit-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/** Read-only presentation fields for a dispatch visit's schedule and assignee. */
export const VISIT_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'id',
    nullable: false,
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique visit identifier',
  },
  date: {
    id: toFieldId('date'),
    key: 'date',
    label: 'Visit date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    nullable: true,
    options: { format: 'medium', includeTime: false },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      computed: true,
    },
    description: 'Date of the scheduled visit in the placeholder timezone',
  },
  startTime: {
    id: toFieldId('startTime'),
    key: 'startTime',
    label: 'Start time',
    type: BaseType.TIME,
    fieldType: FieldType.TIME,
    nullable: true,
    options: { format: 'time-only', timeFormat: '12h' },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      computed: true,
    },
    description: 'Scheduled start time in the placeholder timezone',
  },
  endTime: {
    id: toFieldId('endTime'),
    key: 'endTime',
    label: 'End time',
    type: BaseType.TIME,
    fieldType: FieldType.TIME,
    nullable: true,
    options: { format: 'time-only', timeFormat: '12h' },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      computed: true,
    },
    description: 'Scheduled end time in the placeholder timezone',
  },
  assignee: {
    id: toFieldId('assignee'),
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    dbColumn: 'assigneeWorkerId',
    nullable: true,
    dynamicOptionsKey: 'teamMembers',
    options: { actor: { target: 'worker', multiple: false } },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Team member assigned to the visit',
  },
}
