// packages/lib/src/ai/kopilot/capabilities/record-views/tools/params.ts

import type { SimplifiedFilter } from '../../entities/shared/record-filters'
import type { ViewSpec } from '../build-view-config'

/** Shared filter/sort/column params — same filter grammar as `query_records`. */
const VIEW_PROPERTIES: Record<string, unknown> = {
  filters: {
    type: 'array',
    description: 'Field-level filter conditions (same shape as query_records).',
    items: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Field id/systemAttribute from list_entity_fields.',
        },
        operator: {
          type: 'string',
          description:
            'Filter operator. Common: "is", "is not", "contains", ">", "<", ">=", "<=", "empty", "not empty", "in", "not in", "before", "after", "today", "this_week", "this_month".',
        },
        value: {
          description:
            'Comparison value. Use the option value key for select fields (e.g. "ACTIVE" not "Active"). For "in"/"not in", pass an array.',
        },
      },
      required: ['field', 'operator'],
    },
  },
  logicalOperator: {
    type: 'string',
    enum: ['AND', 'OR'],
    description: 'How to combine filters. Default "AND".',
  },
  sort: {
    type: 'object',
    description: 'Sort order',
    properties: {
      field: { type: 'string', description: 'Field id to sort by' },
      direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
    },
  },
  columns: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Field ids to show as columns, in order. Omit to leave the current columns untouched.',
  },
}

/** Parameters for `preview_table_view`. */
export const RECORD_VIEW_PARAMS: Record<string, unknown> = {
  type: 'object',
  properties: VIEW_PROPERTIES,
  additionalProperties: false,
}

/** Parameters for `create_table_view` — adds a required `name`. */
export const RECORD_VIEW_CREATE_PARAMS: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name for the saved view (max 50 chars), e.g. "Open tickets, newest first".',
    },
    ...VIEW_PROPERTIES,
  },
  required: ['name'],
  additionalProperties: false,
}

/** Pull the shared filter/sort/column spec out of raw tool args. */
export function readViewSpec(args: Record<string, unknown>): ViewSpec {
  return {
    filters: args.filters as SimplifiedFilter[] | undefined,
    logicalOperator: args.logicalOperator as 'AND' | 'OR' | undefined,
    sort: args.sort as { field: string; direction: 'asc' | 'desc' } | undefined,
    columns: args.columns as string[] | undefined,
  }
}
