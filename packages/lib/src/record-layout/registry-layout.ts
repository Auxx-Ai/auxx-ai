// packages/lib/src/record-layout/registry-layout.ts

import {
  type CardBlock,
  cardBlockId,
  DETAILS_BLOCK_ID,
  type FieldsBlock,
  type LayoutBlock,
} from '../resources/registry/block-types'
import type { DetailViewConfig } from '../resources/registry/detail-view-config-types'
import type {
  DrawerTabCardDefinition,
  DrawerTabDefinition,
} from '../resources/registry/drawer-config-types'
import type { RecordLayoutSurface } from './layout-delta'
import type { ResolvedLayout, ResolvedLayoutTab } from './resolved-layout'

/**
 * The **registry default layer** of the record layout system
 * (`plans/drawer/record-layout-system.md` §5).
 *
 * Computed live from the drawer / detail registries and never stored, so
 * changing a shipped layout stays a code-only change with no migration. This is
 * the layer the sparse org and user deltas are merged on top of by
 * `resolveRecordLayout`.
 *
 * Deliberately free of React and of anything in `apps/web`: the resolver runs on
 * the server (the router validates against it) and in the browser (the editor
 * builds its tree from it), so it has to be plain data in `packages/lib`.
 */

/** Tabs whose content is hard-coded rather than composed from blocks. */
const BASE_TAB_IDS = ['timeline', 'comments', 'tasks'] as const

/** The drawer's un-hideable first tab. */
export const OVERVIEW_TAB_ID = 'overview'

/** Base tab ids in the order the drawer renders them, after the entity tabs. */
export const RECORD_LAYOUT_BASE_TAB_IDS: readonly string[] = BASE_TAB_IDS

const BASE_TAB_DEFINITIONS: Record<string, { label: string; icon: string }> = {
  timeline: { label: 'Timeline', icon: 'clock' },
  comments: { label: 'Comments', icon: 'messages' },
  tasks: { label: 'Tasks', icon: 'list-todo' },
}

/** Whether a tab id names one of the hard-coded base tabs. */
export function isBaseTabId(tabId: string): boolean {
  return tabId in BASE_TAB_DEFINITIONS
}

/** Registry input for {@link buildRegistryLayout}. */
export interface RegistryLayoutInput {
  /** Which surface the layout is for. */
  surface: RecordLayoutSurface
  /** The definition's entity type, or its id for a custom definition. */
  entityType: string
  /**
   * Registry drawer config for the drawer surface. Omit for a custom definition
   * with no registry entry, which yields the generic tab set.
   */
  drawerConfig?: {
    entityType: string
    additionalTabs: DrawerTabDefinition[]
    tabCards?: Record<string, DrawerTabCardDefinition[]>
    tabBlocks?: Record<string, LayoutBlock[]>
  }
  /** Registry detail-view config for the detail surface. */
  detailConfig?: DetailViewConfig
  /**
   * True when the viewer may see the Comments tab. The drawer drops that tab
   * entirely when comment access is absent, so the layout must not offer it.
   */
  canViewComments?: boolean
}

function makeTab(input: {
  id: string
  label: string
  icon?: string
  isBaseTab?: boolean
  hideable?: boolean
  hasOwnComponent?: boolean
  blocks?: LayoutBlock[]
}): ResolvedLayoutTab {
  return {
    id: input.id,
    label: input.label,
    icon: input.icon,
    isBaseTab: input.isBaseTab ?? false,
    hideable: input.hideable ?? true,
    hasOwnComponent: input.hasOwnComponent ?? false,
    blocks: input.blocks ?? [],
    hidden: false,
    isCreated: false,
  }
}

/** The whole-record Details field panel every definition has. */
function detailsBlock(): FieldsBlock {
  return { id: DETAILS_BLOCK_ID, kind: 'fields', label: 'Details', icon: 'house' }
}

/**
 * Turn a registry card entry into a `card` block, carrying its gates verbatim.
 *
 * Every gate on the result comes from here and only from here. A stored delta
 * may move this block or hide it, and may never restate any of these keys.
 */
function toCardBlock(card: DrawerTabCardDefinition): CardBlock {
  return {
    id: cardBlockId(card.value),
    kind: 'card',
    cardValue: card.value,
    label: card.label,
    icon: card.icon,
    position: card.position,
    permissionKey: card.permissionKey,
    recordResource: card.recordResource,
    fullBleed: card.fullBleed,
  }
}

/** Split a tab's blocks into the runs that render before and after its content. */
function partitionBlocks(blocks: LayoutBlock[]): {
  before: LayoutBlock[]
  after: LayoutBlock[]
} {
  const before: LayoutBlock[] = []
  const after: LayoutBlock[] = []
  for (const block of blocks) {
    // An unset position renders after the tab's own content, matching TabCards.
    if (block.position === 'before') before.push(block)
    else after.push(block)
  }
  return { before, after }
}

/**
 * Every registry block on one tab, in declaration order: the `card` blocks
 * `tabCards` declares, then the `records` / `fields` blocks `tabBlocks` does.
 *
 * The two lists are separate at the declaration site because only `tabCards`
 * entries resolve to a component key, which is what the drawer card parity test
 * asserts. They are one run from here on.
 */
function registryTabBlocks(
  tabId: string,
  tabCards: Record<string, DrawerTabCardDefinition[]> | undefined,
  tabBlocks: Record<string, LayoutBlock[]> | undefined
): { before: LayoutBlock[]; after: LayoutBlock[] } {
  const cards = (tabCards?.[tabId] ?? []).map(toCardBlock)
  return partitionBlocks([...cards, ...(tabBlocks?.[tabId] ?? [])])
}

function buildBaseTabs(canViewComments: boolean): ResolvedLayoutTab[] {
  return BASE_TAB_IDS.filter((id) => id !== 'comments' || canViewComments).map((id) => {
    const definition = BASE_TAB_DEFINITIONS[id] as { label: string; icon: string }
    // Base tabs render hard-coded content and accept no sections (§9.3), so
    // their block list is always empty. They stay reorderable and hideable.
    return makeTab({ id, label: definition.label, icon: definition.icon, isBaseTab: true })
  })
}

function buildDrawerLayout(input: RegistryLayoutInput): ResolvedLayoutTab[] {
  const { tabCards, tabBlocks } = input.drawerConfig ?? {}
  const overviewBlocks = registryTabBlocks(OVERVIEW_TAB_ID, tabCards, tabBlocks)

  // Overview is un-hideable: it is what `effectiveTab` falls back to and the one
  // tab guaranteed to exist for every entity type. Details sits between the
  // before and after card runs, exactly where <EntityFields> renders today.
  const overview = makeTab({
    id: OVERVIEW_TAB_ID,
    label: 'Overview',
    icon: 'house',
    hideable: false,
    blocks: [...overviewBlocks.before, detailsBlock(), ...overviewBlocks.after],
  })

  const additional = (input.drawerConfig?.additionalTabs ?? []).map((tab) => {
    const blocks = registryTabBlocks(tab.value, tabCards, tabBlocks)
    return makeTab({
      id: tab.value,
      label: tab.label,
      icon: tab.icon,
      // A tab that IS its blocks declares `hasOwnComponent: false`, which is
      // what makes its visibility derived (§7) instead of asserted: with no
      // component to mount, it renders only while one of its blocks is visible.
      hasOwnComponent: tab.hasOwnComponent ?? true,
      blocks: [...blocks.before, ...blocks.after],
    })
  })

  // Overview first, then entity-specific tabs, then the shared trailing tabs
  // the order `base-entity-drawer.tsx` renders today.
  return [overview, ...additional, ...buildBaseTabs(input.canViewComments ?? true)]
}

function buildDetailLayout(input: RegistryLayoutInput): ResolvedLayoutTab[] {
  // `sidebarCards` are deliberately NOT emitted as blocks: the sidebar is a
  // separate region and is out of scope for the editor (§9.7).
  if (!input.detailConfig) return buildBaseTabs(input.canViewComments ?? true)

  const tabBlocks = input.detailConfig.tabBlocks
  return input.detailConfig.mainTabs.map((tab) => {
    if (isBaseTabId(tab.value)) {
      return makeTab({ id: tab.value, label: tab.label, icon: tab.icon, isBaseTab: true })
    }
    const blocks = registryTabBlocks(tab.value, undefined, tabBlocks)
    return makeTab({
      id: tab.value,
      label: tab.label,
      icon: tab.icon,
      hasOwnComponent: tab.hasOwnComponent ?? true,
      blocks: [...blocks.before, ...blocks.after],
    })
  })
}

/**
 * Build the registry default layout for one definition on one surface.
 *
 * A definition with no registry entry (a custom def) yields Overview + Timeline
 * + Comments + Tasks carrying only the Details block: §4.1's "a custom def has
 * an empty registry-default layer", so its whole layout is the org override and
 * there is nothing for the merge rules to drift against.
 */
export function buildRegistryLayout(input: RegistryLayoutInput): ResolvedLayout {
  const tabs = input.surface === 'detail' ? buildDetailLayout(input) : buildDrawerLayout(input)

  const blocksById: Record<string, LayoutBlock> = {}
  for (const tab of tabs) {
    for (const block of tab.blocks) blocksById[block.id] = block
  }

  return { tabs, blocksById, unresolvedBlockIds: [] }
}

/**
 * Flatten a layout's blocks into one order with each tab's run contiguous.
 *
 * This is the baseline `mergeBlockOrder` reconciles a stored `blockOrder`
 * against, and it is the same flat-with-contiguous-runs shape the stored order
 * uses, which is what lets a drop position identify its target tab.
 */
export function flattenBlockOrder(layout: ResolvedLayout): string[] {
  const order: string[] = []
  for (const tab of layout.tabs) {
    for (const block of tab.blocks) order.push(block.id)
  }
  return order
}

/** The layout's tab ids in registry order. */
export function flattenTabOrder(layout: ResolvedLayout): string[] {
  return layout.tabs.map((tab) => tab.id)
}
