// packages/lib/src/record-layout/resolved-layout.ts

import type { LayoutBlock } from '../resources/registry/block-types'

/**
 * The output of layering the registry default under the stored deltas
 * (`plans/drawer/record-layout-system.md` §5).
 *
 * This is what both surfaces render and what the editor edits. Note the shape
 * differs from the stored delta on purpose: storage keys tab membership on the
 * block (`blocks[id].tab`) so the delta stays sparse, while the resolver hands
 * back tabs that already own their block lists, because that is what the
 * renderer and the grouped drag editor both need.
 */

/** A tab in the resolved layout. */
export interface ResolvedLayoutTab {
  /** Tab id, i.e. the registry `value` or an admin-created tab's generated id. */
  id: string
  label: string
  /** Icon name resolved through `getIconComponent`. */
  icon?: string
  /**
   * Whether this tab renders hard-coded content rather than blocks.
   *
   * Timeline, Comments and Tasks are base tabs: they accept no sections and
   * reject section drops, but stay reorderable and hideable exactly as today.
   */
  isBaseTab: boolean
  /**
   * Whether the viewer may hide this tab. Overview is `false` so the strip can
   * never empty out.
   */
  hideable: boolean
  /**
   * Whether this tab mounts a lazily loaded component of its own, on top of any
   * blocks placed on it. An additional registry tab does; an admin-created tab
   * does not.
   */
  hasOwnComponent: boolean
  /** Blocks placed on this tab, in render order. */
  blocks: LayoutBlock[]
  /** True when an admin hid this tab. */
  hidden: boolean
  /** True when the tab came from the stored delta rather than the registry. */
  isCreated: boolean
}

/** A record surface's fully resolved layout. */
export interface ResolvedLayout {
  /** Tabs in display order, hidden ones included so the editor can list them. */
  tabs: ResolvedLayoutTab[]
  /**
   * Every placed block by id, for callers that need a block without walking
   * tabs (gate evaluation, the editor's "already placed" check).
   */
  blocksById: Record<string, LayoutBlock>
  /**
   * Ids present in the stored delta that no longer resolve to anything: a
   * retired card, a deleted custom field, a dropped relationship.
   *
   * Skipped at read time and deliberately NOT deleted from the stored delta, so
   * a temporarily absent block returns to its old placement rather than losing
   * it.
   */
  unresolvedBlockIds: string[]
}
