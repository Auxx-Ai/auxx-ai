// packages/lib/src/ai/kopilot/capabilities/record-views/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createCreateRecordViewTool } from './tools/create-record-view'
import { createListTableViewsTool } from './tools/list-table-views'
import { createPreviewRecordViewTool } from './tools/preview-record-view'
import { createSetDefaultRecordViewTool } from './tools/set-default-record-view'
import { createUpdateRecordViewTool } from './tools/update-record-view'

/** Page key for the records table surface (Contacts, Companies, custom entities). */
export const RECORDS_PAGE = 'records'

/**
 * Records-page capability: preview, save, list, edit, and set the default of
 * filtered table views. Scoped to the records table page — these tools never
 * appear elsewhere. The entity/table is taken from the page's `resource`
 * session ref, so the model never picks it.
 */
export function createRecordViewCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: RECORDS_PAGE,
    tools: [
      createPreviewRecordViewTool(getDeps),
      createCreateRecordViewTool(getDeps),
      createListTableViewsTool(getDeps),
      createUpdateRecordViewTool(getDeps),
      createSetDefaultRecordViewTool(getDeps),
    ],
    systemPromptAddition: (ctx) => buildPrompt(ctx),
    capabilities: ({ toolNames }) => {
      const bullets: string[] = []
      if (toolNames.has('preview_table_view') || toolNames.has('create_table_view')) {
        bullets.push('Preview and save filtered, sorted table views on the current records page')
      }
      if (
        toolNames.has('list_table_views') ||
        toolNames.has('update_table_view') ||
        toolNames.has('set_default_table_view')
      ) {
        bullets.push(
          'List, edit, and set the default of saved table views on the current records page'
        )
      }
      return bullets
    },
  }
}

function buildPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const hasPreview = toolNames.has('preview_table_view')
  const hasCreate = toolNames.has('create_table_view')
  const hasList = toolNames.has('list_table_views')
  const hasUpdate = toolNames.has('update_table_view')
  const hasSetDefault = toolNames.has('set_default_table_view')
  if (!hasPreview && !hasCreate && !hasList && !hasUpdate && !hasSetDefault) return ''

  const lines: string[] = [
    'The user is viewing a records table for one entity type. You build table views for THAT entity — the table is taken from the page, never passed by you.',
    'Filters/sort use the same grammar as `query_records`. Call `list_entity_fields` first to get field ids and valid option value keys (uppercase codes like "ACTIVE", not labels).',
    'Date filters: "in the last N days" is the `within_days` operator with a number (e.g. 30); `before`/`after`/`on_date` take an absolute "YYYY-MM-DD" date; `today`/`this_week`/`this_month` take no value. Never use a relative string like "now-30d".',
  ]
  if (hasPreview) {
    lines.push(
      '`preview_table_view` applies a filter/sort/column set to the on-screen table instantly and is NOT saved — use it to show the user a result.'
    )
  }
  if (hasCreate) {
    lines.push(
      '`create_table_view` saves a NEW named view and switches to it. Prefer previewing first, then saving once the user is happy. Names must be unique on the table. Use it only to create — never re-call it to edit, rename, or make-default an existing view.'
    )
  }
  if (hasList) {
    lines.push(
      '`list_table_views` lists the saved views on this table with their ids — call it first to get the `viewId` for editing or making a view the default.'
    )
  }
  if (hasUpdate) {
    lines.push(
      '`update_table_view` edits an EXISTING view by `viewId` (get it from `list_table_views`). Only the parts you pass change (filters/sort/columns/name); everything else is kept. Pass `filters: []` to clear filters. When the user says "change/rename/add a filter to <a saved view>", use this — not `create_table_view`.'
    )
  }
  if (hasSetDefault) {
    lines.push(
      '`set_default_table_view` makes a view the org default for everyone (and shares it). When the user says "make it/this the default", call `list_table_views` to get the `viewId`, then `set_default_table_view` — never `create_table_view`. Admins/owners only; the approval card is the confirmation, so just call it (don\'t also ask "shall I proceed?") and don\'t promise it will work for non-admins.'
    )
  }
  return `## Record views\n\n${lines.join('\n')}`
}
