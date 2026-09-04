// packages/lib/src/conditions/field-view-config.ts

import { z } from 'zod'

/**
 * Context types for different view contexts.
 *
 * `drawer` and `detail` are not field configs at all: their `TableView.config`
 * holds a sparse record-layout delta (`@auxx/lib/record-layout`), which is why
 * they are classified as structural contexts and excluded from the `savedViews`
 * plan limit. See `plans/drawer/record-layout-system.md` §5 / §5.1.
 */
export const viewContextTypes = [
  'table',
  'kanban',
  'panel',
  'dialog_create',
  'dialog_edit',
  'drawer',
  'detail',
] as const

/**
 * View context type:
 * 'table' | 'kanban' | 'panel' | 'dialog_create' | 'dialog_edit' | 'drawer' | 'detail'
 */
export type ViewContextType = (typeof viewContextTypes)[number]

/** Zod schema for validating view context types */
export const viewContextTypeSchema = z.enum(viewContextTypes)

/**
 * A labelled, collapsible group of fields in the property panel.
 *
 * Groups are a view-config concern only — they never enter `resource.fields`,
 * so no surface that consumes the field registry has to know about them.
 */
export const fieldGroupSchema = z.object({
  /** Stable id, generated client-side. */
  id: z.string(),
  label: z.string(),
  /** Persisted collapse state (org-wide, per context). */
  collapsed: z.boolean().optional(),
  /** Optional icon id for the group header. */
  icon: z.string().optional(),
  /**
   * Explicit membership: resourceFieldIds belonging to this group.
   * Membership is independent of `fieldOrder`; a group's POSITION is derived
   * from where its first member sits in `fieldOrder`. Ids of deleted fields are
   * harmless and skipped at read time.
   */
  fieldIds: z.array(z.string()),
  /**
   * Where an EMPTY group renders: immediately before this field.
   *
   * Read only while `fieldIds` has no surviving member, and ignored entirely
   * once the group has one — a populated group's position is still derived from
   * where its first member sits in `fieldOrder`, so this can never disagree with
   * that. It exists because an empty group has no member to derive a position
   * from at all, which left a freshly created group pinned at the end of the
   * list and impossible to move until something was dragged into it.
   *
   * Unset, or naming a field that no longer exists, means "render at the end" —
   * the same convention as before.
   */
  anchorFieldId: z.string().optional(),
})

/** A labelled, collapsible group of fields in the property panel */
export type FieldGroup = z.infer<typeof fieldGroupSchema>

/**
 * Field view configuration schema for panel and dialog views.
 * This config controls which fields are visible and their order.
 */
export const fieldViewConfigSchema = z.object({
  /** Which fields are visible (resourceFieldId -> boolean) */
  fieldVisibility: z.record(z.string(), z.boolean()),
  /** Field display order (array of resourceFieldIds) */
  fieldOrder: z.array(z.string()),
  /**
   * Collapsible field groups for the panel. A field absent from every group's
   * `fieldIds` renders ungrouped — the safe default, so a newly created field
   * never silently joins a group it was not put in.
   *
   * Replaces the former `collapsedSections`, which was declared and documented
   * but read by nothing; per-group collapse state now lives on
   * `fieldGroups[].collapsed`. `TableView.config` is jsonb with no DB-level
   * shape and zod strips unknown keys on read, so stale `collapsedSections`
   * values in existing rows are inert — no data migration needed.
   */
  fieldGroups: z.array(fieldGroupSchema).optional(),
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
