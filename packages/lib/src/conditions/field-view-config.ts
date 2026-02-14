// packages/lib/src/conditions/field-view-config.ts

import { z } from 'zod'

/**
 * Context types for different view contexts
 */
export const viewContextTypes = [
  'table',
  'kanban',
  'panel',
  'dialog_create',
  'dialog_edit',
] as const

/** View context type: 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit' */
export type ViewContextType = (typeof viewContextTypes)[number]

/** Zod schema for validating view context types */
export const viewContextTypeSchema = z.enum(viewContextTypes)

/**
 * Field view configuration schema for panel and dialog views.
 * This config controls which fields are visible and their order.
 */
export const fieldViewConfigSchema = z.object({
  /** Which fields are visible (resourceFieldId -> boolean) */
  fieldVisibility: z.record(z.string(), z.boolean()),
  /** Field display order (array of resourceFieldIds) */
  fieldOrder: z.array(z.string()),
  /** Fields that should be collapsed/hidden by default in panel */
  collapsedSections: z.array(z.string()).optional(),
  /** Custom labels override for fields */
  fieldLabels: z.record(z.string(), z.string()).optional(),
  /** Whether to show field labels/titles in panel */
  showLabels: z.boolean().optional().default(true),
})

/** Field view configuration type */
export type FieldViewConfig = z.infer<typeof fieldViewConfigSchema>

/**
 * Creates a default field view config with all fields visible.
 * @param fieldIds - Array of field IDs to include (all visible by default)
 */
export function createDefaultFieldViewConfig(fieldIds: string[]): FieldViewConfig {
  return {
    fieldVisibility: Object.fromEntries(fieldIds.map((id) => [id, true])),
    fieldOrder: fieldIds,
    showLabels: true,
  }
}
