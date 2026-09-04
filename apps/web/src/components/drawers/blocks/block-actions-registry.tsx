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
 * Empty on purpose in stage 1. The three action-carrying cards
 * (`service-request-related-cards`, `quote-jobs-card`, `purchase-order-bills-card`)
 * keep their bespoke code and stay `card` blocks; this exists so the seam is
 * real and typed before the first one moves.
 */
export const BLOCK_ACTIONS_COMPONENTS: Record<
  string,
  () => Promise<{ default: ComponentType<BlockActionsProps> }>
> = {}

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
