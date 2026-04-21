// apps/web/src/components/kopilot/ui/blocks/block-schemas.ts

import { REFERENCE_BLOCK_TYPES } from '@auxx/lib/ai/kopilot/blocks/block-types'
import { z } from 'zod'

export { REFERENCE_BLOCK_TYPES }

// ─── Reference block snapshots (server-injected into fence JSON) ───
// Snapshots are minimal: just enough to render a card when hydration is
// pending OR the record has been deleted. Live hydration is still the
// source of truth for current state.

export const entitySnapshotSchema = z.object({
  recordId: z.string(),
  entityDefinitionId: z.string(),
  displayName: z.string(),
  summary: z.string().optional(),
})

export const threadSnapshotSchema = z.object({
  threadId: z.string(),
  subject: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  sender: z.string().optional(),
  isUnread: z.boolean().optional(),
})

export const taskSnapshotSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string().nullable(),
  completedAt: z.string().nullable(),
})

// ─── Reference block payloads (LLM writes ids; server injects snapshots) ───

export const entityCardSchema = z.object({
  recordId: z.string(),
  snapshot: entitySnapshotSchema.optional(),
})

export const entityListSchema = z.object({
  recordIds: z.array(z.string()),
  snapshot: z.record(z.string(), entitySnapshotSchema).optional(),
})

export const threadListSchema = z.object({
  threadIds: z.array(z.string()),
  snapshot: z.record(z.string(), threadSnapshotSchema).optional(),
})

export const taskListSchema = z.object({
  taskIds: z.array(z.string()),
  snapshot: z.record(z.string(), taskSnapshotSchema).optional(),
})

export const draftPreviewSchema = z.object({
  draftId: z.string(),
  threadId: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  body: z.string(),
  subject: z.string().optional(),
})

export const kbArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  url: z.string().optional(),
})

export const kbArticleListSchema = z.object({
  query: z.string().optional(),
  articles: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      excerpt: z.string().optional(),
      url: z.string().optional(),
      datasetName: z.string().optional(),
      score: z.number().optional(),
    })
  ),
})

export const entityDefinitionFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  fieldType: z.string().optional(),
  systemAttribute: z.string().nullable().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  relationship: z
    .object({
      targetEntityDefinitionId: z.string().nullable().optional(),
      relationshipType: z.string().optional(),
    })
    .optional(),
})

export const entityDefinitionSchema = z.object({
  entityDefinitionId: z.string(),
  label: z.string().optional(),
  fields: z.array(entityDefinitionFieldSchema),
})

export const planStepsSchema = z.object({
  steps: z.array(
    z.object({
      label: z.string(),
      status: z.enum(['pending', 'running', 'completed', 'failed']),
      detail: z.string().optional(),
    })
  ),
})

export const actionResultSchema = z.object({
  action: z.string(),
  success: z.boolean(),
  summary: z.string(),
  recordId: z.string().optional(),
  recordIds: z.array(z.string()).optional(),
  threadId: z.string().optional(),
  messageId: z.string().optional(),
  draftId: z.string().optional(),
  taskId: z.string().optional(),
  count: z.number().optional(),
})

const CELL_TYPE_VALUES = ['actor', 'date', 'tags', 'email', 'phone', 'currency', 'number'] as const
type CellType = (typeof CELL_TYPE_VALUES)[number]
const CELL_TYPES = new Set<string>(CELL_TYPE_VALUES)
/** Aliases small models frequently use for the `href` prop. */
const LINK_TYPE_ALIASES = new Set(['href', 'link', 'url'])
const URL_PREFIX_RE = /^(https?:|mailto:|tel:)/i

/**
 * Permissive table-cell schema. The LLM sometimes mis-places concerns — e.g.
 * `type: "href"` when it meant the `href` prop, or a typo'd type like
 * `"hyperlink"`. Rather than rejecting the whole table, we coerce:
 *   - unknown `type` values → dropped (undefined)
 *   - `type: "href"|"link"|"url"` + URL-looking `text` → auto-promote to `href`
 */
export const tableCellSchema = z
  .object({
    text: z.string(),
    recordId: z.string().optional(),
    href: z.string().optional(),
    type: z.string().optional(),
    actorId: z.string().optional(),
    tags: z
      .array(
        z.object({
          label: z.string(),
          color: z.string().optional(),
        })
      )
      .optional(),
  })
  .transform((cell) => {
    const rawType = cell.type
    const cleanType: CellType | undefined =
      rawType && CELL_TYPES.has(rawType) ? (rawType as CellType) : undefined

    let href = cell.href
    if (
      !href &&
      rawType &&
      LINK_TYPE_ALIASES.has(rawType.toLowerCase()) &&
      URL_PREFIX_RE.test(cell.text)
    ) {
      href = cell.text
    }

    return { ...cell, type: cleanType, href }
  })

export const tableColumnSchema = z.object({
  label: z.string(),
  align: z.enum(['left', 'center', 'right']).optional(),
})

export const tableBlockSchema = z.object({
  columns: z.array(tableColumnSchema),
  rows: z.array(z.array(tableCellSchema)),
})

export const docsResultsSchema = z.object({
  articles: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      description: z.string().nullable().optional(),
    })
  ),
  query: z.string().optional(),
})

/** Registry of block type → Zod schema */
export const BLOCK_SCHEMAS: Record<string, z.ZodType> = {
  'thread-list': threadListSchema,
  'entity-card': entityCardSchema,
  'entity-list': entityListSchema,
  'entity-definition': entityDefinitionSchema,
  'draft-preview': draftPreviewSchema,
  'kb-article': kbArticleSchema,
  'kb-article-list': kbArticleListSchema,
  'plan-steps': planStepsSchema,
  'action-result': actionResultSchema,
  'docs-results': docsResultsSchema,
  table: tableBlockSchema,
  'task-list': taskListSchema,
}

/** Inferred types for block components */
export type EntitySnapshotData = z.infer<typeof entitySnapshotSchema>
export type ThreadSnapshotData = z.infer<typeof threadSnapshotSchema>
export type TaskSnapshotData = z.infer<typeof taskSnapshotSchema>
export type ThreadListData = z.infer<typeof threadListSchema>
export type EntityCardData = z.infer<typeof entityCardSchema>
export type EntityListData = z.infer<typeof entityListSchema>
export type DraftPreviewData = z.infer<typeof draftPreviewSchema>
export type KBArticleData = z.infer<typeof kbArticleSchema>
export type KBArticleListData = z.infer<typeof kbArticleListSchema>
export type EntityDefinitionFieldData = z.infer<typeof entityDefinitionFieldSchema>
export type EntityDefinitionData = z.infer<typeof entityDefinitionSchema>
export type PlanStepsData = z.infer<typeof planStepsSchema>
export type ActionResultData = z.infer<typeof actionResultSchema>
export type DocsResultsData = z.infer<typeof docsResultsSchema>
export type TableCellData = z.infer<typeof tableCellSchema>
export type TableColumnData = z.infer<typeof tableColumnSchema>
export type TableBlockData = z.infer<typeof tableBlockSchema>
export type TaskListData = z.infer<typeof taskListSchema>
