// packages/lib/src/ai/kopilot/capabilities/record-views/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createCreateRecordViewTool } from './tools/create-record-view'
import { createPreviewRecordViewTool } from './tools/preview-record-view'

/** Page key for the records table surface (Contacts, Companies, custom entities). */
export const RECORDS_PAGE = 'records'

/**
 * Records-page capability: preview + save filtered table views. Scoped to the
 * records table page — these tools never appear elsewhere. The entity/table is
 * taken from the page's `resource` session ref, so the model never picks it.
 */
export function createRecordViewCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: RECORDS_PAGE,
    tools: [createPreviewRecordViewTool(getDeps), createCreateRecordViewTool(getDeps)],
    systemPromptAddition: (ctx) => buildPrompt(ctx),
    capabilities: ({ toolNames }) =>
      toolNames.has('preview_table_view') || toolNames.has('create_table_view')
        ? ['Preview and save filtered, sorted table views on the current records page']
        : [],
  }
}

function buildPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const hasPreview = toolNames.has('preview_table_view')
  const hasCreate = toolNames.has('create_table_view')
  if (!hasPreview && !hasCreate) return ''

  const lines: string[] = [
    'The user is viewing a records table for one entity type. You build table views for THAT entity — the table is taken from the page, never passed by you.',
    'Filters/sort use the same grammar as `query_records`. Call `list_entity_fields` first to get field ids and valid option value keys (uppercase codes like "ACTIVE", not labels).',
  ]
  if (hasPreview) {
    lines.push(
      '`preview_table_view` applies a filter/sort/column set to the on-screen table instantly and is NOT saved — use it to show the user a result.'
    )
  }
  if (hasCreate) {
    lines.push(
      '`create_table_view` saves a named view and switches to it. Prefer previewing first, then saving once the user is happy. Names must be unique on the table.'
    )
  }
  return `## Record views\n\n${lines.join('\n')}`
}
