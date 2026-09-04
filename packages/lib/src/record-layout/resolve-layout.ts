// packages/lib/src/record-layout/resolve-layout.ts

import type { FieldsBlock, LayoutBlock, RecordsBlock } from '../resources/registry/block-types'
import { parseFieldsBlockConfig, parseRecordsBlockConfig } from './block-config-schemas'
import type { AddedTab, BlockDelta, CreatedBlock, RecordLayoutDelta } from './layout-delta'
import { mergeBlockOrder } from './merge-block-order'
import { flattenBlockOrder, flattenTabOrder } from './registry-layout'
import type { ResolvedLayout, ResolvedLayoutTab } from './resolved-layout'

/**
 * Layer the sparse stored deltas on top of the registry default
 * (`plans/drawer/record-layout-system.md` §6).
 *
 * ```
 * registry default  <  org override  <  user override
 * ```
 *
 * Deltas are **sparse in, sparse out**: this function reads them and never
 * produces something a writer could save back as a layout. Materializing a full
 * snapshot on first edit freezes every untouched default forever and recreates
 * the migration treadmill `plans/view-config/layered-view-config.md` §2.1 exists
 * to document, so the resolved layout is a render input only.
 *
 * **The hard invariant (§5, §7):** a delta governs placement and visibility
 * only. It can never introduce or widen `permissionKey`, `recordResource` or
 * `featureGate`: every gate on a registry block is copied from the registry
 * entry for that block id, and a user-created `records` block derives its
 * `recordResource` from the definition it lists so it cannot leak counts.
 */

/** How a relation-sourced created block finds the definition it lists. */
export type RelationTargetResolver = (relationAttr: string) => string | undefined

export interface ResolveRecordLayoutParams {
  /** The registry default layer, from `buildRegistryLayout`. */
  registry: ResolvedLayout
  /** The org override (`TableView`, `isShared` + `isDefault`). */
  orgDelta?: RecordLayoutDelta | null
  /** The viewer's personal override (`TableViewPreference`). */
  userDelta?: RecordLayoutDelta | null
  /**
   * Map an inverse relationship attribute to the definition it points at, so a
   * created `records` block reading a relation mirror can still be gated on its
   * target's read level. Without it such a block carries no `recordResource`,
   * which is why the caller (which holds the field metadata) should supply it.
   */
  resolveRelationTarget?: RelationTargetResolver
}

/** A block delta with the org layer underneath and the user layer on top. */
function mergeBlockDelta(base: BlockDelta | undefined, over: BlockDelta | undefined): BlockDelta {
  return {
    tab: over?.tab ?? base?.tab,
    position: over?.position ?? base?.position,
    hidden: over?.hidden ?? base?.hidden,
    config: base?.config || over?.config ? { ...base?.config, ...over?.config } : undefined,
  }
}

function collectBlockDeltas(
  orgDelta: RecordLayoutDelta | null | undefined,
  userDelta: RecordLayoutDelta | null | undefined
): Record<string, BlockDelta> {
  const merged: Record<string, BlockDelta> = {}
  const ids = new Set([
    ...Object.keys(orgDelta?.blocks ?? {}),
    ...Object.keys(userDelta?.blocks ?? {}),
  ])
  for (const id of ids) {
    merged[id] = mergeBlockDelta(orgDelta?.blocks?.[id], userDelta?.blocks?.[id])
  }
  return merged
}

/**
 * Build a created block, or return `null` when its config does not validate.
 *
 * Gates are set here and nowhere else. A created block never carries a
 * `permissionKey` or a `featureGate`: those are registry facts, and a stored
 * layout that claimed one would be declaring capability.
 */
function buildCreatedBlock(
  id: string,
  entry: CreatedBlock,
  delta: BlockDelta | undefined,
  resolveRelationTarget: RelationTargetResolver | undefined
): LayoutBlock | null {
  const config = { ...entry.config, ...delta?.config }

  if (entry.kind === 'fields') {
    const parsed = parseFieldsBlockConfig(config)
    if (!parsed) return null
    const block: FieldsBlock = {
      id,
      kind: 'fields',
      label: entry.label,
      icon: entry.icon,
      position: delta?.position,
      config: parsed,
    }
    return block
  }

  const parsed = parseRecordsBlockConfig(config)
  if (!parsed) return null
  // Derived, never stored: the block lists another definition's records, so it
  // gates on that definition's read level exactly as a registry `recordResource`
  // does (§7).
  const recordResource =
    parsed.source.kind === 'query'
      ? parsed.source.definition
      : resolveRelationTarget?.(parsed.source.relationAttr)
  const block: RecordsBlock = {
    id,
    kind: 'records',
    label: entry.label,
    icon: entry.icon,
    position: delta?.position,
    recordResource,
    config: parsed,
  }
  return block
}

/** Registry blocks re-emitted with only their PLACEMENT overridden. */
function applyPlacement(block: LayoutBlock, delta: BlockDelta | undefined): LayoutBlock {
  if (!delta?.position || delta.position === block.position) return block
  return { ...block, position: delta.position }
}

function cloneTab(tab: ResolvedLayoutTab): ResolvedLayoutTab {
  return { ...tab, blocks: [] }
}

function addedTabToResolved(tab: AddedTab): ResolvedLayoutTab {
  return {
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    isBaseTab: false,
    hideable: true,
    hasOwnComponent: false,
    blocks: [],
    hidden: false,
    isCreated: true,
  }
}

/**
 * Resolve a record surface's layout for one viewer.
 *
 * @returns tabs in display order (hidden ones included so the editor can list
 * them), every placed block by id, and the stored ids that resolved to nothing.
 */
export function resolveRecordLayout(params: ResolveRecordLayoutParams): ResolvedLayout {
  const { registry, orgDelta, userDelta, resolveRelationTarget } = params

  // ── Registry facts ────────────────────────────────────────────────────────
  const registryBlocks = new Map<string, LayoutBlock>()
  const registryTabOfBlock = new Map<string, string>()
  for (const tab of registry.tabs) {
    for (const block of tab.blocks) {
      registryBlocks.set(block.id, block)
      registryTabOfBlock.set(block.id, tab.id)
    }
  }

  const blockDeltas = collectBlockDeltas(orgDelta, userDelta)
  const unresolved: string[] = []
  const unresolvedSeen = new Set<string>()
  const markUnresolved = (id: string) => {
    if (unresolvedSeen.has(id)) return
    unresolvedSeen.add(id)
    unresolved.push(id)
  }

  // ── Created blocks ────────────────────────────────────────────────────────
  // A created entry may not shadow a registry block id: the registry stays the
  // sole source of truth for what a shipped block is and how it is gated.
  const createdEntries: Array<[string, CreatedBlock]> = [
    ...Object.entries(orgDelta?.created ?? {}),
    ...Object.entries(userDelta?.created ?? {}),
  ]
  const createdBlocks = new Map<string, LayoutBlock>()
  for (const [id, entry] of createdEntries) {
    if (registryBlocks.has(id) || createdBlocks.has(id)) continue
    const block = buildCreatedBlock(id, entry, blockDeltas[id], resolveRelationTarget)
    // A created entry whose config fails validation is unresolved, not thrown:
    // one broken row must not take a whole drawer down.
    if (!block) markUnresolved(id)
    else createdBlocks.set(id, block)
  }

  const allBlocks = new Map<string, LayoutBlock>([...registryBlocks, ...createdBlocks])

  // ── Order ─────────────────────────────────────────────────────────────────
  // A block explicitly moved to another tab sits inside that tab's run, so it
  // must never anchor a newly shipped registry block (which would splice the
  // new block onto the wrong tab).
  const movedIds = new Set(
    Object.entries(blockDeltas)
      .filter(([, delta]) => delta.tab !== undefined)
      .map(([id]) => id)
  )
  const isGrouped = (id: string) => movedIds.has(id)

  const baselineOrder = [...flattenBlockOrder(registry), ...createdBlocks.keys()]
  let blockOrder = baselineOrder
  for (const storedOrder of [orgDelta?.blockOrder, userDelta?.blockOrder]) {
    if (!storedOrder) continue
    for (const id of storedOrder) if (!allBlocks.has(id)) markUnresolved(id)
    blockOrder = mergeBlockOrder({ baseline: blockOrder, storedOrder, isGrouped })
  }
  for (const id of Object.keys(blockDeltas)) if (!allBlocks.has(id)) markUnresolved(id)

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabsById = new Map<string, ResolvedLayoutTab>()
  for (const tab of registry.tabs) tabsById.set(tab.id, cloneTab(tab))

  const addedTabs: AddedTab[] = []
  for (const tab of [...(orgDelta?.tabs?.added ?? []), ...(userDelta?.tabs?.added ?? [])]) {
    if (tabsById.has(tab.id)) continue
    tabsById.set(tab.id, addedTabToResolved(tab))
    addedTabs.push(tab)
  }

  const orderedRegistryTabIds = flattenTabOrder(registry)
  const firstPlaceableTabId =
    orderedRegistryTabIds.find((id) => tabsById.get(id)?.isBaseTab === false) ??
    orderedRegistryTabIds[0]

  // ── Place blocks ──────────────────────────────────────────────────────────
  const hiddenBlockIds = new Set(
    Object.entries(blockDeltas)
      .filter(([, delta]) => delta.hidden === true)
      .map(([id]) => id)
  )

  /** Where a block ends up, honouring the delta but never losing the block. */
  const resolveTabId = (blockId: string): string | undefined => {
    const requested = blockDeltas[blockId]?.tab
    const fallback = registryTabOfBlock.get(blockId) ?? firstPlaceableTabId
    if (!requested) return fallback
    const target = tabsById.get(requested)
    // Base tabs render hard-coded content and accept no sections (§9.3), and a
    // tab that no longer exists must not swallow the block.
    if (!target || target.isBaseTab) return fallback
    return requested
  }

  const tabOfBlock = new Map<string, string>()
  const blocksById: Record<string, LayoutBlock> = {}
  for (const blockId of blockOrder) {
    // An explicit admin hide stays hidden through any later registry change, so
    // the block is dropped from the resolved layout entirely. The editor lists
    // hidden blocks from the stored delta, not from here.
    if (hiddenBlockIds.has(blockId)) continue
    const block = allBlocks.get(blockId)
    if (!block) continue
    const tabId = resolveTabId(blockId)
    if (!tabId) continue
    const tab = tabsById.get(tabId)
    if (!tab) continue
    const placed = applyPlacement(block, blockDeltas[blockId])
    tab.blocks.push(placed)
    tabOfBlock.set(blockId, tabId)
    blocksById[blockId] = placed
  }

  // ── Tab order ─────────────────────────────────────────────────────────────
  const baselineTabOrder = [...orderedRegistryTabIds]
  for (const added of addedTabs) {
    baselineTabOrder.splice(
      addedTabInsertIndex(added, baselineTabOrder, blockOrder, tabOfBlock),
      0,
      added.id
    )
  }

  let tabOrder = baselineTabOrder
  for (const storedOrder of [orgDelta?.tabs?.order, userDelta?.tabs?.order]) {
    if (!storedOrder) continue
    tabOrder = mergeBlockOrder({ baseline: tabOrder, storedOrder })
  }

  const hiddenTabIds = new Set([
    ...(orgDelta?.tabs?.hidden ?? []),
    ...(userDelta?.tabs?.hidden ?? []),
  ])

  const tabs: ResolvedLayoutTab[] = []
  for (const tabId of tabOrder) {
    const tab = tabsById.get(tabId)
    if (!tab) continue
    // Overview can never be hidden, or the strip empties out (§9.6).
    tab.hidden = tab.hideable && hiddenTabIds.has(tabId)
    tabs.push(tab)
  }

  return { tabs, blocksById, unresolvedBlockIds: unresolved }
}

/**
 * Where an admin-created tab sits in the baseline order.
 *
 * A populated tab derives its position from where its first block sits in the
 * merged block order, which is why `blockOrder` keeps each tab's run
 * contiguous. A tab holding NO block has nothing to derive a position from, so
 * it falls back to its own stored `anchorTabId` and renders immediately before
 * that tab: the empty-tab twin of `fieldGroupSchema.anchorFieldId`, and it
 * exists for the identical reason.
 */
function addedTabInsertIndex(
  added: AddedTab,
  baselineTabOrder: string[],
  blockOrder: string[],
  tabOfBlock: Map<string, string>
): number {
  const firstBlockIndex = blockOrder.findIndex((id) => tabOfBlock.get(id) === added.id)
  if (firstBlockIndex >= 0) {
    for (let i = firstBlockIndex - 1; i >= 0; i--) {
      const neighbourTab = tabOfBlock.get(blockOrder[i] as string)
      if (!neighbourTab || neighbourTab === added.id) continue
      const index = baselineTabOrder.indexOf(neighbourTab)
      if (index >= 0) return index + 1
    }
    return 0
  }

  if (added.anchorTabId) {
    const index = baselineTabOrder.indexOf(added.anchorTabId)
    if (index >= 0) return index
  }

  return baselineTabOrder.length
}
