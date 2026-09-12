// apps/web/src/components/drawers/blocks/block-actions-registry.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'

/**
 * Props every block actions component receives.
 *
 * Deliberately the same two identifiers a `records` block already has, so an
 * actions component is a plain drawer component and nothing about the block
 * config leaks into it.
 */
export interface BlockActionsProps {
  /** Full recordId of the HOST record the block is placed on. */
  recordId: RecordId
  /** Instance half of {@link BlockActionsProps.recordId}, for filter values. */
  entityInstanceId: string
}

/**
 * The `records` block escape hatch (`plans/drawer/record-layout-system.md` §4).
 *
 * A `records` block's READ is config; its ACTIONS are not. Encoding create rows,
 * guard queries, mutations and dialogs as schema keys would grow a key per
 * feature until the config is a worse programming language, so a block that
 * carries an action names a component here instead and pure-read blocks name
 * none.
 *
 * Keyed by the bare `RecordsBlockConfig.actionsComponent` name (NOT
 * `entityType:value` like `DRAWER_TAB_CARD_COMPONENTS`), because an actions
 * component is chosen by the block, not by the definition it happens to sit on:
 * the same "create quote" row belongs on a contact block and a service-request
 * block alike.
 *
 * ✅ **No longer empty.** `ticket-returns` is the first consumer, and it proved
 * the seam end to end rather than on paper: `ticket-returns-block-seam.test.tsx`
 * renders the REAL `RecordListBlock` with the real block config and pins that
 * the action mounts after the `EmptyRow` - the ticket-with-no-return case, which
 * is the one that matters (plans/money/tasks/54-returns.md section 4.1).
 *
 * The three older action-carrying cards (`service-request-related-cards`,
 * `quote-jobs-card`, `purchase-order-bills-card`) still keep their bespoke code
 * and stay `card` blocks. Moving them is now a question of appetite rather than
 * of whether the seam works.
 *
 * ⚠️ One documented constraint turned out to be FALSE and is corrected here:
 * section 4.1 says "if a header `+` is wanted, this seam does not provide it".
 * `layout-block-section.tsx` wraps every block - `records` included - in
 * `DrawerCardActionsProvider`, so an actions component CAN portal into the
 * section header with `<DrawerCardActions>`. `ticket-returns` deliberately does
 * not: below-the-rows is the documented placement and the covered path.
 */
export const BLOCK_ACTIONS_COMPONENTS: Record<
  string,
  () => Promise<{ default: ComponentType<BlockActionsProps> }>
> = {
  'ticket-returns': () => import('../../tickets/ticket-returns-actions'),
}

/**
 * Resolve a block's `actionsComponent` name to its loader.
 *
 * An unknown name resolves to `undefined` rather than throwing: a stored layout
 * may still name an actions component that has since been retired, and a
 * missing action must degrade to the pure-read section, never to a broken tab.
 */
export function getBlockActionsComponent(
  name: string | undefined
): (() => Promise<{ default: ComponentType<BlockActionsProps> }>) | undefined {
  if (!name) return undefined
  return BLOCK_ACTIONS_COMPONENTS[name]
}
