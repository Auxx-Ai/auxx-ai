// apps/web/src/components/kopilot/ui/blocks/block-schemas.ts

import { z } from 'zod'

export const threadItemSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.string(),
  lastMessageAt: z.string().optional(),
  sender: z.string().optional(),
  assigneeId: z.string().optional(),
  isUnread: z.boolean().optional(),
  messageCount: z.number().optional(),
  tagIds: z.array(z.string()).optional(),
})

export const threadListSchema = z.array(threadItemSchema)

export const entityCardSchema = z.object({
  recordId: z.string(),
})

export const entityListSchema = z.array(entityCardSchema)

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
})

export const tableCellSchema = z.object({
  text: z.string(),
  recordId: z.string().optional(),
  href: z.string().optional(),
  // Type hint for rich rendering
  type: z.enum(['actor', 'date', 'tags', 'email', 'phone', 'currency', 'number']).optional(),
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
  'draft-preview': draftPreviewSchema,
  'kb-article': kbArticleSchema,
  'plan-steps': planStepsSchema,
  'action-result': actionResultSchema,
  'docs-results': docsResultsSchema,
  table: tableBlockSchema,
}

/** Inferred types for block components */
export type ThreadItem = z.infer<typeof threadItemSchema>
export type ThreadListData = z.infer<typeof threadListSchema>
export type EntityCardData = z.infer<typeof entityCardSchema>
export type EntityListData = z.infer<typeof entityListSchema>
export type DraftPreviewData = z.infer<typeof draftPreviewSchema>
export type KBArticleData = z.infer<typeof kbArticleSchema>
export type PlanStepsData = z.infer<typeof planStepsSchema>
export type ActionResultData = z.infer<typeof actionResultSchema>
export type DocsResultsData = z.infer<typeof docsResultsSchema>
export type TableCellData = z.infer<typeof tableCellSchema>
export type TableColumnData = z.infer<typeof tableColumnSchema>
export type TableBlockData = z.infer<typeof tableBlockSchema>
