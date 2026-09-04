// packages/lib/src/record-layout/block-config-schemas.ts

import { z } from 'zod'
import type { FieldsBlockConfig, RecordsBlockConfig } from '../resources/registry/block-types'

/**
 * Runtime validation for the config of an admin-CREATED block.
 *
 * `block-types.ts` declares these shapes as TypeScript interfaces because a
 * registry entry is code and needs no parsing. A created block is different: its
 * config arrives from `TableView.config`, which is untyped jsonb, so it has to
 * be parsed before anything renders from it.
 *
 * Every schema here is **strip-mode** (zod's default), and that is the point.
 * The stored layout governs placement and visibility only
 * (`plans/drawer/record-layout-system.md` §5), so an unknown key smuggled into a
 * stored config (`permissionKey`, `recordResource`, `featureGate`) is dropped
 * here rather than reaching a block. Gates are always taken from the registry
 * entry, or derived from the block's target definition.
 */

/** Read the host record's inverse relationship mirror. */
export const recordsRelationSourceSchema = z.object({
  kind: z.literal('relation'),
  relationAttr: z.string().min(1),
})

/** Read the target definition directly with a filter, sort and page size. */
export const recordsQuerySourceSchema = z.object({
  kind: z.literal('query'),
  definition: z.string().min(1),
  hostFieldId: z.string().min(1),
  sort: z.object({ fieldId: z.string().min(1), desc: z.boolean().optional() }).optional(),
  pageSize: z.number().int().positive().max(200).optional(),
})

/** The two reads are deliberately not interchangeable. */
export const recordsSourceSchema = z.discriminatedUnion('kind', [
  recordsRelationSourceSchema,
  recordsQuerySourceSchema,
])

/** Config for a `records` block. */
export const recordsBlockConfigSchema = z.object({
  source: recordsSourceSchema,
  statusAttr: z.string().min(1).optional(),
  emptyLabel: z.string().optional(),
  visibleLimit: z.number().int().positive().max(200).optional(),
  actionsComponent: z.string().min(1).optional(),
})

/** Config for a `fields` block. Omitted `fieldGroupId` means the whole record. */
export const fieldsBlockConfigSchema = z.object({
  fieldGroupId: z.string().min(1).optional(),
})

/** Parsed `records` block config. Structurally identical to the interface. */
export type ParsedRecordsBlockConfig = z.infer<typeof recordsBlockConfigSchema>

/** Parsed `fields` block config. Structurally identical to the interface. */
export type ParsedFieldsBlockConfig = z.infer<typeof fieldsBlockConfigSchema>

/**
 * Parse a created `records` block's config, returning `null` when it does not
 * validate.
 *
 * A created entry whose config is broken is treated as UNRESOLVED, never thrown:
 * one bad row must not take a whole drawer down, and keeping the stored entry
 * means a fix restores the block in place.
 */
export function parseRecordsBlockConfig(config: unknown): RecordsBlockConfig | null {
  const parsed = recordsBlockConfigSchema.safeParse(config)
  return parsed.success ? parsed.data : null
}

/** Parse a created `fields` block's config. An absent config is valid (`{}`). */
export function parseFieldsBlockConfig(config: unknown): FieldsBlockConfig | null {
  const parsed = fieldsBlockConfigSchema.safeParse(config ?? {})
  return parsed.success ? parsed.data : null
}
