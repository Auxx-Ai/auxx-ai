// apps/web/src/components/records/layout/use-block-visibility.ts
'use client'

/**
 * The block gate chain in **predicate** form
 * (`plans/drawer/record-layout-system.md` §7).
 *
 * `useIsBlockVisible` (`components/drawers/blocks/layout-block-section.tsx`)
 * answers the same question, but it takes the block as an argument and calls
 * three hooks inside, so it cannot be used as `TabVisibilityContext.isBlockVisible`:
 * derived tab visibility has to evaluate EVERY block of every tab before
 * rendering anything, and the block count changes between renders (the stored
 * layout deltas arrive after the registry default), which would change the hook
 * count. This hook reads the three gates once and hands back a plain function.
 *
 * Gates are read from the block the registry produced, never from stored layout
 * data: a delta governs placement and visibility only, so moving a block cannot
 * widen who may see it (§5, "the hard invariant").
 */

import type { LayoutBlock } from '@auxx/lib/resources/client'
import { useCallback } from 'react'
import { isRestrictedDrawerTab } from '~/components/drawers/drawer-tab-registry'
import { useCanViewRecordResource } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/** Context the gates are evaluated against. */
export interface BlockVisibilityParams {
  /** The surface's entity type, e.g. `contact`, `work_order`. */
  entityType: string
  /** True in restricted (read-only) drawer mode. */
  readOnly?: boolean
}

/**
 * The value a block is gated by in restricted (read-only) mode.
 *
 * `RESTRICTED_HIDDEN_DRAWER_TABS` is keyed by card/tab value, so a `card` block
 * must present its `cardValue` and not its `card:`-prefixed block id, or
 * restricted mode silently stops hiding communication cards.
 */
function restrictedValue(block: LayoutBlock): string {
  return block.kind === 'card' ? block.cardValue : block.id
}

/**
 * A stable `(block) => boolean` predicate over the four block gates.
 *
 * Feed it to `visibleLayoutTabs` / `visibleTabBlocks` as
 * `TabVisibilityContext.isBlockVisible`.
 */
export function useBlockVisibility({
  entityType,
  readOnly,
}: BlockVisibilityParams): (block: LayoutBlock) => boolean {
  const { can } = useAccess()
  const canViewRecordResource = useCanViewRecordResource()
  const { hasAccess } = useFeatureFlags()

  return useCallback(
    (block: LayoutBlock) => {
      // Org feature gate.
      if (block.featureGate && !hasAccess(block.featureGate)) return false
      // Restricted mode drops communication blocks (e.g. work_order:communications).
      if (readOnly && isRestrictedDrawerTab(entityType, restrictedValue(block))) return false
      // Layer-2 capability gate. Hides the whole section, header included,
      // mirroring the block's router procedure gate.
      if (block.permissionKey && !can(block.permissionKey)) return false
      // Layer-3 per-definition gate for a block that is purely another
      // definition's records.
      if (!canViewRecordResource(block.recordResource)) return false
      return true
    },
    [can, canViewRecordResource, hasAccess, entityType, readOnly]
  )
}
