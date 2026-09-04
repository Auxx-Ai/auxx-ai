// packages/lib/src/record-layout/layout-delta.ts

import { z } from 'zod'

/**
 * The stored half of the record layout system
 * (`plans/drawer/record-layout-system.md` §5).
 *
 * A `TableView` row whose `contextType` is `drawer` or `detail` holds a
 * **sparse delta**, never a layout. Only keys an admin actually touched are
 * stored; everything else falls through to the registry default, which is
 * computed live from code and never written down.
 *
 * This is the one rule the whole design rests on. Materializing a full snapshot
 * on first edit freezes every untouched default forever and recreates the
 * migration treadmill that `plans/view-config/layered-view-config.md` §2.1 exists
 * to document. No write path may ever produce a complete layout.
 */

/** A tab an admin created, which has no registry entry to fall back to. */
export const addedTabSchema = z.object({
  /** Generated id, also the key used in `blocks[].tab`. */
  id: z.string(),
  label: z.string(),
  /** Icon name resolved through `getIconComponent`. */
  icon: z.string().optional(),
  /**
   * Where a tab with no surviving block renders: immediately before this tab.
   *
   * The empty-tab twin of `fieldGroupSchema.anchorFieldId`, and it exists for
   * the identical reason. A tab's position is derived from where its first
   * block sits in `blockOrder`, so a tab holding no block has nothing to derive
   * a position from and would pin itself to the end of the strip. Read only
   * while the tab is empty, ignored the moment it holds a block, so the two can
   * never disagree.
   */
  anchorTabId: z.string().optional(),
})

/** A tab an admin created. */
export type AddedTab = z.infer<typeof addedTabSchema>

/** Tab-level deltas: order, hiding, and admin-created tabs. */
export const tabsDeltaSchema = z.object({
  /**
   * Tab ids in display order. Merged against the live registry order, so a tab
   * that ships later still appears rather than being invisible to every org
   * that ever saved a layout.
   */
  order: z.array(z.string()).optional(),
  /** Explicitly hidden tab ids. Never resurrected by a later registry change. */
  hidden: z.array(z.string()).optional(),
  /** Tabs with no registry entry. */
  added: z.array(addedTabSchema).optional(),
})

/** Per-block placement delta. Placement and visibility only, never capability. */
export const blockDeltaSchema = z.object({
  /** Tab this block was moved to. Absent means "wherever the registry puts it". */
  tab: z.string().optional(),
  /** Render order relative to the tab's built-in content. */
  position: z.enum(['before', 'after']).optional(),
  /**
   * Explicit admin hide. Distinct from a block that merely renders nothing:
   * a hidden block stays hidden through any later registry change.
   */
  hidden: z.boolean().optional(),
  /** Overrides for a user-created block's own config (label, limit, ...). */
  config: z.record(z.string(), z.unknown()).optional(),
})

/** Per-block placement delta. */
export type BlockDelta = z.infer<typeof blockDeltaSchema>

/**
 * A block that exists only because an admin created it, so it has no registry
 * entry supplying its kind or config.
 */
export const createdBlockSchema = z.object({
  /** Only user-creatable kinds. A `card` has no meaning without a component. */
  kind: z.enum(['fields', 'records']),
  label: z.string(),
  icon: z.string().optional(),
  /** Kind-specific config, validated by the block's own schema on read. */
  config: z.record(z.string(), z.unknown()).optional(),
})

/** A block an admin created. */
export type CreatedBlock = z.infer<typeof createdBlockSchema>

/**
 * The full sparse delta stored in `TableView.config` for a `drawer` or
 * `detail` context.
 */
export const recordLayoutDeltaSchema = z.object({
  tabs: tabsDeltaSchema.optional(),
  /**
   * Block ids in a single flat order, with each tab's members **contiguous**.
   *
   * Deliberately one flat array rather than a per-tab list, mirroring how
   * `fieldOrder` carries `fieldGroups[].fieldIds`. That contiguity is what lets
   * a drop position identify its target tab, which is what makes the existing
   * grouped drag component usable for the editor without a second model.
   *
   * Sparse like everything else: a block missing from this array takes its
   * registry-anchored position.
   */
  blockOrder: z.array(z.string()).optional(),
  /** Placement deltas keyed by block id. */
  blocks: z.record(z.string(), blockDeltaSchema).optional(),
  /** Admin-created blocks keyed by their generated id. */
  created: z.record(z.string(), createdBlockSchema).optional(),
})

/** The sparse layout delta stored per definition per surface. */
export type RecordLayoutDelta = z.infer<typeof recordLayoutDeltaSchema>

/** An empty delta, i.e. "the registry default, unchanged". */
export const EMPTY_RECORD_LAYOUT_DELTA: RecordLayoutDelta = {}

/**
 * Which surface a layout applies to. Both surfaces share one config shape and
 * one resolver, so a section placed once renders in the drawer and the detail
 * view alike.
 */
export const recordLayoutSurfaces = ['drawer', 'detail'] as const

/** Surface a record layout applies to. */
export type RecordLayoutSurface = (typeof recordLayoutSurfaces)[number]
