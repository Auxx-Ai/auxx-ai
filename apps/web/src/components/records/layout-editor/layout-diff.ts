// apps/web/src/components/records/layout-editor/layout-diff.ts

import type {
  AddedTab,
  BlockDelta,
  RecordLayoutDelta,
  ResolvedLayout,
} from '@auxx/lib/record-layout/client'
import {
  flattenBlockOrder,
  flattenTabOrder,
  resolveRecordLayout,
} from '@auxx/lib/record-layout/client'
import type { LayoutEditorState } from './editor-state'

/**
 * Turn the editor's staged state back into the two SPARSE deltas it writes
 * (`plans/drawer/record-layout-system.md` §5 / §9.5).
 *
 * This is the single most load-bearing function in the editor, for one reason:
 * the router REPLACES a layer's stored config wholesale, so whatever comes out
 * of here is the entire stored layout for that layer. A version of this that
 * assembled a full snapshot from the resolved layout would freeze every
 * untouched registry default forever and recreate exactly the migration
 * treadmill `plans/view-config/layered-view-config.md` §2.1 exists to document.
 *
 * So every key below is emitted only after being compared against what the
 * REGISTRY would have produced, and the comparison uses the real resolver as the
 * oracle rather than a second reimplementation of the merge rules:
 *
 * 1. The org delta is built from the registry, then resolved.
 * 2. The personal delta is diffed against THAT resolution, so a member's stored
 * tab order only ever records a departure from what the org already says.
 *
 * The split between the two follows §9.5's table exactly. Personal: tab order
 * and tab hiding, which every member has had via localStorage and must not lose.
 * Org: section placement, tab creation and section hiding, which change the
 * surface for everyone and are def-admin gated.
 */

/** The two layers a save writes, each sparse and each independently skippable. */
export interface LayoutSaveDeltas {
  /** Section placement, created tabs and blocks, hidden sections. Def-admin. */
  org: RecordLayoutDelta
  /** Tab order and hidden tabs. Any member. */
  user: RecordLayoutDelta
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((value) => set.has(value))
}

/** Which tab the registry puts each block on. */
function registryTabOfBlock(registry: ResolvedLayout): Map<string, string> {
  const map = new Map<string, string>()
  for (const tab of registry.tabs) {
    for (const block of tab.blocks) map.set(block.id, tab.id)
  }
  return map
}

/** The created tabs still present in the staged state, in staged order. */
function addedTabsOf(state: LayoutEditorState): AddedTab[] {
  const added: AddedTab[] = []
  for (const tabId of state.tabOrder) {
    const tab = state.tabs[tabId]
    if (!tab?.isCreated) continue
    added.push({
      id: tab.id,
      label: tab.label,
      ...(tab.icon ? { icon: tab.icon } : {}),
      ...(tab.anchorTabId ? { anchorTabId: tab.anchorTabId } : {}),
    })
  }
  return added
}

/**
 * Per-block placement deltas, keyed only for blocks that actually differ.
 *
 * A registry block sitting where the registry put it, un-hidden, contributes
 * NOTHING: that is what keeps the write sparse and what lets a block shipped
 * later still land at its registry-anchored position for an org that saved a
 * layout years ago (§6).
 */
function blockDeltasOf(
  state: LayoutEditorState,
  registry: ResolvedLayout
): Record<string, BlockDelta> {
  const registryTab = registryTabOfBlock(registry)
  const hidden = new Set(state.hiddenBlocks)
  const blocks: Record<string, BlockDelta> = {}

  for (const blockId of state.blockOrder) {
    const entry: BlockDelta = {}
    const stagedTab = state.tabOfBlock[blockId]
    // A created block has no registry placement at all, so its tab is always
    // part of the delta; without it the resolver would fall back to the first
    // placeable tab and the admin's choice would be lost.
    if (stagedTab !== undefined && stagedTab !== registryTab.get(blockId)) entry.tab = stagedTab
    if (hidden.has(blockId)) entry.hidden = true
    if (Object.keys(entry).length > 0) blocks[blockId] = entry
  }

  return blocks
}

/**
 * The ORG layer's own tab order: the registry order with each created tab
 * spliced in at its `anchorTabId`.
 *
 * A pure function of the org delta, and deliberately independent of
 * `state.tabOrder`, which carries the viewer's personal reordering. Without this
 * the two layers feed back into each other: the flat block order would be
 * grouped by a personally reordered tab strip, the resolver would then derive a
 * created tab's position from that order, and creating a tab would write a
 * personal `tabs.order` row for something that is an org-scope edit.
 *
 * It mirrors `addedTabInsertIndex`'s anchor branch, which is the same rule the
 * resolver applies to a tab that holds no block.
 */
function orgTabOrder(registry: ResolvedLayout, added: readonly AddedTab[]): string[] {
  const order = flattenTabOrder(registry)
  for (const tab of added) {
    const at = tab.anchorTabId ? order.indexOf(tab.anchorTabId) : -1
    if (at === -1) order.push(tab.id)
    else order.splice(at, 0, tab.id)
  }
  return order
}

/**
 * The staged block order re-expressed in the ORG layer's tab order.
 *
 * `state.blockOrder` is grouped by `state.tabOrder`, which carries the viewer's
 * PERSONAL tab reordering. Storing it as-is would smuggle that personal order
 * into a row every member of the org reads: reordering one tab would rewrite the
 * org's flat order and, on the next resolve, move sections for everybody.
 *
 * Re-grouping by the org's own tab order keeps the two layers independent. Each
 * tab's internal sequence is the staged one: that is the part the org layer
 * genuinely owns: while where the tab SITS stays a personal fact.
 */
function orgBlockOrder(state: LayoutEditorState, tabOrder: readonly string[]): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  for (const tabId of tabOrder) {
    for (const blockId of state.blockOrder) {
      if (seen.has(blockId)) continue
      if (state.tabOfBlock[blockId] !== tabId) continue
      seen.add(blockId)
      order.push(blockId)
    }
  }
  // A block on a tab the org layer does not know about still has to survive.
  for (const blockId of state.blockOrder) {
    if (!seen.has(blockId)) order.push(blockId)
  }
  return order
}

/** Drop `undefined` keys and empty objects so the stored JSON stays minimal. */
function pruneDelta(delta: RecordLayoutDelta): RecordLayoutDelta {
  const pruned: RecordLayoutDelta = {}
  if (delta.tabs) {
    const tabs: NonNullable<RecordLayoutDelta['tabs']> = {}
    if (delta.tabs.order?.length) tabs.order = delta.tabs.order
    if (delta.tabs.hidden?.length) tabs.hidden = delta.tabs.hidden
    if (delta.tabs.added?.length) tabs.added = delta.tabs.added
    if (Object.keys(tabs).length > 0) pruned.tabs = tabs
  }
  if (delta.blockOrder?.length) pruned.blockOrder = delta.blockOrder
  if (delta.blocks && Object.keys(delta.blocks).length > 0) pruned.blocks = delta.blocks
  if (delta.created && Object.keys(delta.created).length > 0) pruned.created = delta.created
  return pruned
}

export interface DiffEditorStateParams {
  /** The registry default layer, from `buildRegistryLayout`. */
  registry: ResolvedLayout
  state: LayoutEditorState
}

/** Build the sparse org and personal deltas for one staged state. */
export function diffEditorState(params: DiffEditorStateParams): LayoutSaveDeltas {
  const { registry, state } = params

  // ── Org layer ─────────────────────────────────────────────────────────────
  const created: RecordLayoutDelta['created'] = {}
  for (const [blockId, entry] of Object.entries(state.created)) {
    if (state.tabOfBlock[blockId] === undefined) continue
    created[blockId] = entry
  }

  const org: RecordLayoutDelta = {
    tabs: { added: addedTabsOf(state) },
    blocks: blockDeltasOf(state, registry),
    created,
  }

  // The probe asks "where would these placements ALONE put every block". It must
  // not hide anything, because `state.blockOrder` lists hidden blocks too, and
  // it carries no order of its own: that is the whole question being asked.
  const probe: RecordLayoutDelta = {
    tabs: org.tabs,
    blocks: Object.fromEntries(
      Object.entries(org.blocks ?? {}).map(([id, entry]) => [id, { tab: entry.tab }])
    ),
    created: org.created,
  }
  const probed = resolveRecordLayout({ registry, orgDelta: probe })
  const staged = orgBlockOrder(state, orgTabOrder(registry, org.tabs?.added ?? []))

  // Stored only when placement alone cannot express the staged sequence, which
  // is what makes "move one section to another tab" a delta that mentions one
  // block and nothing else. When it IS stored it is the whole order,
  // deliberately: `mergeBlockOrder` reconciles a stored order against the live
  // registry and splices newly shipped blocks in at their anchor, so a complete
  // order is a reconcilable photograph rather than a frozen snapshot. A partial
  // order has no such guarantee: the ids it omits would be anchored against
  // whatever happened to survive in it.
  if (!sameOrder(flattenBlockOrder(probed), staged)) org.blockOrder = staged

  const prunedOrg = pruneDelta(org)

  // ── Personal layer ────────────────────────────────────────────────────────
  // Diffed against the org resolution, not the registry: a member whose order
  // already matches what the org publishes stores nothing at all.
  const orgResolved = resolveRecordLayout({ registry, orgDelta: prunedOrg })
  const publishedTabOrder = flattenTabOrder(orgResolved)
  const orgHiddenTabs = orgResolved.tabs.filter((tab) => tab.hidden).map((tab) => tab.id)

  const user: RecordLayoutDelta = { tabs: {} }
  if (!sameOrder(publishedTabOrder, state.tabOrder)) {
    ;(user.tabs as NonNullable<RecordLayoutDelta['tabs']>).order = state.tabOrder
  }
  if (!sameSet(orgHiddenTabs, state.hiddenTabs)) {
    ;(user.tabs as NonNullable<RecordLayoutDelta['tabs']>).hidden = state.hiddenTabs
  }

  return { org: prunedOrg, user: pruneDelta(user) }
}

/**
 * A stable serialization of a delta pair, for "did this session change
 * anything" comparisons.
 *
 * Both sides always come out of {@link diffEditorState}, so key order is
 * deterministic and a plain `JSON.stringify` is sound, the same argument
 * `use-field-view-draft`'s dirty check rests on.
 */
export function serializeSaveDeltas(deltas: LayoutSaveDeltas): { org: string; user: string } {
  return { org: JSON.stringify(deltas.org), user: JSON.stringify(deltas.user) }
}

/** One layer to write, in the order the dialog writes them. */
export interface LayoutSaveWrite {
  scope: 'org' | 'personal'
  delta: RecordLayoutDelta
}

export interface PlanLayoutSaveParams {
  /** Whether the viewer may write the ORG scope. */
  canAdministerDef: boolean
  /** Whether the org layer differs from what is stored. */
  orgDirty: boolean
  /** Whether the personal layer differs from what is stored. */
  personalDirty: boolean
  deltas: LayoutSaveDeltas
}

/**
 * Which mutations one Save actually performs (§9.5).
 *
 * Split out of the dialog so the routing is testable without a render, because
 * getting it wrong is silent in both directions: writing the org layer for an
 * ordinary member 403s, and writing the personal layer for an admin's section
 * move would store a structural change where only that one member sees it.
 *
 * Two rules, both load-bearing:
 *
 * - A layer is written only when it CHANGED. An untouched layer is not rewritten
 * with its own current value, so a member opening the dialog and closing it
 * with Save cannot stamp their user id onto the org's row.
 * - The org layer is written only by someone who may write it. When
 * `canAdministerDef` is false the org-scope affordances are absent, so a
 * non-empty org diff there can only come from a stale render: dropping it is
 * the fail-closed answer, and the router asserts the same rule anyway.
 */
export function planLayoutSave(params: PlanLayoutSaveParams): LayoutSaveWrite[] {
  const { canAdministerDef, orgDirty, personalDirty, deltas } = params
  const writes: LayoutSaveWrite[] = []
  if (canAdministerDef && orgDirty) writes.push({ scope: 'org', delta: deltas.org })
  if (personalDirty) writes.push({ scope: 'personal', delta: deltas.user })
  return writes
}
