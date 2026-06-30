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
            'Filter operator. Common: "is", "is not", "contains", ">", "<", ">=", "<=", "empty", "not empty", "in", "not in". Dates: "within_days" / "older_than_days" (value = number of days), "before" / "after" / "on_date" (value = absolute date "YYYY-MM-DD"), "today" / "yesterday" / "this_week" / "this_month" (no value).',
        },
        value: {
          description:
            'Comparison value. Use the option value key for select fields (e.g. "ACTIVE" not "Active"). For "in"/"not in", pass an array. For dates, "in the last N days" is "within_days" with a NUMBER (e.g. 30) — NOT "after" with a relative string like "now-30d"; "before"/"after"/"on_date" take an absolute "YYYY-MM-DD" date.',
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

/**
 * Parameters for `update_table_view` — a required `viewId` plus an optional
 * rename and any of the filter/sort/column props. Only the props passed change;
 * everything else on the view is kept.
 */
export const RECORD_VIEW_UPDATE_PARAMS: Record<string, unknown> = {
  type: 'object',
  properties: {
    viewId: {
      type: 'string',
      description: 'Id of the view to edit — get it from list_table_views.',
    },
    name: {
      type: 'string',
      description: 'New name for the view (max 50 chars). Omit to keep the current name.',
    },
    ...VIEW_PROPERTIES,
  },
  required: ['viewId'],
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
