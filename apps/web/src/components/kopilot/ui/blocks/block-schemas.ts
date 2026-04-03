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

/** Registry of block type → Zod schema */
export const BLOCK_SCHEMAS: Record<string, z.ZodType> = {
  'thread-list': threadListSchema,
  'entity-card': entityCardSchema,
  'entity-list': entityListSchema,
  'draft-preview': draftPreviewSchema,
  'kb-article': kbArticleSchema,
  'plan-steps': planStepsSchema,
  'action-result': actionResultSchema,
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
