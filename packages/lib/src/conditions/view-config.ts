// packages/lib/src/conditions/view-config.ts

import { z } from 'zod'
import { conditionGroupSchema } from './schema'

// ============================================================================
// COLUMN FORMATTING SCHEMAS
// ============================================================================

/** Currency formatting schema */
export const currencyFormattingSchema = z.object({
  type: z.literal('currency'),
  currencyCode: z.string().optional(),
  decimalPlaces: z.enum(['two-places', 'no-decimal']).optional(),
  displayType: z.enum(['symbol', 'name', 'code']).optional(),
  groups: z.enum(['default', 'no-groups']).optional(),
})

/** Date formatting schema */
export const dateFormattingSchema = z.object({
  type: z.literal('date'),
  format: z.enum(['short', 'medium', 'long', 'relative', 'iso']).optional(),
  includeTime: z.boolean().optional(),
})

/** Number formatting schema */
export const numberFormattingSchema = z.object({
  type: z.literal('number'),
  decimalPlaces: z.number().optional(),
  useGrouping: z.boolean().optional(),
  displayAs: z.enum(['number', 'percentage', 'compact', 'bytes']).optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})

/** Combined column formatting schema */
export const columnFormattingSchema = z.union([
  currencyFormattingSchema,
  dateFormattingSchema,
  numberFormattingSchema,
])

// ============================================================================
// KANBAN SCHEMAS
// ============================================================================

/** Kanban column settings schema */
export const kanbanColumnSettingsSchema = z.object({
  isVisible: z.boolean().optional(),
})

/** Kanban view config schema */
export const kanbanConfigSchema = z.object({
  groupByFieldId: z.string(),
  columnOrder: z.array(z.string()).optional(),
  collapsedColumns: z.array(z.string()).optional(),
  cardFields: z.array(z.string()).optional(),
  primaryFieldId: z.string().optional(),
  columnSettings: z.record(z.string(), kanbanColumnSettingsSchema).optional(),
})

// ============================================================================
// VIEW CONFIG SCHEMA (SINGLE SOURCE OF TRUTH)
// ============================================================================

/** View configuration schema - used for validation in tRPC router */
export const viewConfigSchema = z.object({
  filters: z.array(conditionGroupSchema),
  sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })),
  columnVisibility: z.record(z.string(), z.boolean()),
  columnOrder: z.array(z.string()),
  columnSizing: z.record(z.string(), z.number()),
  columnPinning: z
    .object({
      left: z.array(z.string()).optional(),
      right: z.array(z.string()).optional(),
    })
    .optional(),
  columnLabels: z.record(z.string(), z.string()).optional(),
  columnFormatting: z.record(z.string(), columnFormattingSchema).optional(),
  rowHeight: z.enum(['compact', 'normal', 'spacious']).optional(),
  viewType: z.enum(['table', 'kanban']).optional().default('table'),
  kanban: kanbanConfigSchema.optional(),
})

// ============================================================================
// INFERRED TYPES (derived from schemas - always in sync)
// ============================================================================

export type CurrencyColumnFormatting = z.infer<typeof currencyFormattingSchema>
export type DateColumnFormatting = z.infer<typeof dateFormattingSchema>
export type NumberColumnFormatting = z.infer<typeof numberFormattingSchema>
export type ColumnFormatting = z.infer<typeof columnFormattingSchema>
export type KanbanColumnSettings = z.infer<typeof kanbanColumnSettingsSchema>
export type KanbanViewConfig = z.infer<typeof kanbanConfigSchema>
export type ViewConfig = z.infer<typeof viewConfigSchema>
export type ViewType = ViewConfig['viewType']
