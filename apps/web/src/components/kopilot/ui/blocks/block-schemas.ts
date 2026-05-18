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
  /** Resource-specific hints for renderers (e.g. article slug + knowledgeBaseId for deep links). */
  extras: z.record(z.string(), z.string()).optional(),
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

export const draftSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(['reply', 'standalone']),
  subject: z.string().nullable(),
  recipientSummary: z.string().nullable(),
  snippet: z.string().nullable(),
  updatedAt: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  threadId: z.string().nullable(),
})

// ─── Reference block payloads (LLM writes ids; server injects snapshots) ───

// All `<X>Id(s)` fields are `.optional()` and arrays default to an empty list
// in the renderers. This keeps the partial-JSON output produced mid-stream
// validatable from the very first delta, so the block stays mounted instead
// of flipping to `FallbackBlock` and re-running entrance animations.

export const entityCardSchema = z.object({
  recordId: z.string().optional(),
  snapshot: entitySnapshotSchema.optional(),
})

export const entityListSchema = z.object({
  recordIds: z.array(z.string()).optional(),
  snapshot: z.record(z.string(), entitySnapshotSchema).optional(),
})

export const threadListSchema = z.object({
  threadIds: z.array(z.string()).optional(),
  snapshot: z.record(z.string(), threadSnapshotSchema).optional(),
})

export const taskListSchema = z.object({
  taskIds: z.array(z.string()).optional(),
  snapshot: z.record(z.string(), taskSnapshotSchema).optional(),
})

export const draftListSchema = z.object({
  draftIds: z.array(z.string()).optional(),
  snapshot: z.record(z.string(), draftSnapshotSchema).optional(),
})

export const entityDefinitionFieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
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

// A malformed field is coerced to a blank entry rather than rejecting the
// whole block — mirrors how the table tolerates partial cells.
const entityDefinitionFieldPartialSafe = entityDefinitionFieldSchema.catch({})

export const entityDefinitionSchema = z.object({
  entityDefinitionId: z.string().optional(),
  label: z.string().optional(),
  fields: z.array(entityDefinitionFieldPartialSafe).optional(),
})

/**
 * Permissive plan-steps schema. While the LLM is mid-stream, the partial-JSON
 * parser produces steps that are missing fields (e.g. `status` hasn't arrived
 * yet). Keeping every field optional lets validation pass continuously instead
 * of flipping pass → fail → pass on each step boundary, which would otherwise
 * remount the block and re-run every step's entrance animation.
 *
 * The renderer fills in defaults (status → 'pending') and skips steps that
 * haven't yet streamed a label.
 */
const planStepPartialSafe = z
  .object({
    label: z.string().optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
    detail: z.string().optional(),
  })
  .catch({})

export const planStepsSchema = z.object({
  steps: z.array(planStepPartialSafe).optional(),
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

/**
 * `columns` / `rows` are optional so the schema also accepts the best-effort
 * output of the partial-JSON parser during streaming — the renderer defaults
 * both to `[]` and grows the table as more data arrives.
 *
 * `.catch()` on each element keeps a single malformed cell/column from
 * rejecting the whole table: the offending entry is coerced to a blank
 * placeholder so the rest of the table renders progressively.
 */
const tableColumnPartialSafe = tableColumnSchema.catch({ label: '' })
const tableCellPartialSafe = tableCellSchema.catch({
  text: '',
  type: undefined,
  href: undefined,
})

export const tableBlockSchema = z.object({
  columns: z.array(tableColumnPartialSafe).optional(),
  rows: z.array(z.array(tableCellPartialSafe)).optional(),
})

/** Registry of block type → Zod schema */
export const BLOCK_SCHEMAS: Record<string, z.ZodType> = {
  'thread-list': threadListSchema,
  'entity-card': entityCardSchema,
  'entity-list': entityListSchema,
  'entity-definition': entityDefinitionSchema,
  'plan-steps': planStepsSchema,
  table: tableBlockSchema,
  'task-list': taskListSchema,
  'draft-list': draftListSchema,
}

/** Inferred types for block components */
export type EntitySnapshotData = z.infer<typeof entitySnapshotSchema>
export type ThreadSnapshotData = z.infer<typeof threadSnapshotSchema>
export type TaskSnapshotData = z.infer<typeof taskSnapshotSchema>
export type DraftSnapshotData = z.infer<typeof draftSnapshotSchema>
export type ThreadListData = z.infer<typeof threadListSchema>
export type EntityCardData = z.infer<typeof entityCardSchema>
export type EntityListData = z.infer<typeof entityListSchema>
export type EntityDefinitionFieldData = z.infer<typeof entityDefinitionFieldSchema>
export type EntityDefinitionData = z.infer<typeof entityDefinitionSchema>
export type PlanStepsData = z.infer<typeof planStepsSchema>
export type TableCellData = z.infer<typeof tableCellSchema>
export type TableColumnData = z.infer<typeof tableColumnSchema>
export type TableBlockData = z.infer<typeof tableBlockSchema>
export type TaskListData = z.infer<typeof taskListSchema>
export type DraftListData = z.infer<typeof draftListSchema>
