// packages/lib/src/record-layout/tab-visibility.ts

import type { LayoutBlock } from '../resources/registry/block-types'
import type { ResolvedLayout, ResolvedLayoutTab } from './resolved-layout'

/**
 * Derived tab visibility (`plans/drawer/record-layout-system.md` §7).
 *
 * A tab used to carry one `recordResource` and gate on it. With N blocks per tab
 * the rule becomes "visible if any block is visible for this viewer", and it has
 * to be computed BEFORE render.
 *
 * CSS cannot answer this. The current empty-section rule is
 * `HIDE_WHEN_CARD_RENDERS_NOTHING`, which hides a section via
 * `:has([data-slot=section-content]:empty)` *after* it has rendered nothing. A
 * tab whose every block is gated out would still show as a clickable empty tab.
 */

/** What the viewer is allowed to see, supplied by the rendering surface. */
export interface TabVisibilityContext {
  /**
   * Whether this viewer may see the block, i.e. its `permissionKey`,
   * `recordResource` and `featureGate` all pass. Gates come from the block,
   * which took them from the registry, never from a stored delta.
   */
  isBlockVisible: (block: LayoutBlock) => boolean
  /**
   * Whether a tab that mounts a component of its own is allowed for this viewer
   * (the registry tab's own `recordResource` / `featureGate` / restricted-mode
   * rules, which the resolved tab does not carry). Defaults to allowed.
   */
  isTabAllowed?: (tab: ResolvedLayoutTab) => boolean
}

/**
 * Whether this viewer is CAPABLE of seeing a tab, ignoring whether they chose
 * to hide it.
 *
 * - An un-hideable tab (Overview) always qualifies, so the strip can never
 *   empty out.
 * - A base tab renders hard-coded content, so it is never empty.
 * - A tab with its own component qualifies while that component is allowed.
 * - Otherwise the tab is exactly its blocks: it qualifies only if one of them
 *   is visible.
 *
 * Split from {@link isTabVisible} because hiding and capability answer
 * different questions. A surface that offers a way back to a hidden tab (the
 * drawer's strip excepts the ACTIVE tab, so a deep link into a hidden tab still
 * resolves) needs the capability answer, while the hidden set stays a separate
 * input. Folding the two together is what silently turns such a deep link into
 * a redirect.
 */
export function isTabPermitted(tab: ResolvedLayoutTab, ctx: TabVisibilityContext): boolean {
  if (!tab.hideable) return true
  if (tab.isBaseTab) return true
  if (tab.hasOwnComponent && (ctx.isTabAllowed?.(tab) ?? true)) return true
  return tab.blocks.some((block) => ctx.isBlockVisible(block))
}

/**
 * Whether a resolved tab should render at all: permitted, and not hidden by
 * the viewer or an admin.
 */
export function isTabVisible(tab: ResolvedLayoutTab, ctx: TabVisibilityContext): boolean {
  if (tab.hidden) return false
  return isTabPermitted(tab, ctx)
}

/** The tabs of a resolved layout that should render, in display order. */
export function visibleLayoutTabs(
  layout: ResolvedLayout,
  ctx: TabVisibilityContext
): ResolvedLayoutTab[] {
  return layout.tabs.filter((tab) => isTabVisible(tab, ctx))
}

/**
 * The tabs this viewer is capable of seeing, hidden ones INCLUDED, in display
 * order.
 *
 * For a strip that takes a separate `hidden` list and excepts the active tab
 * from it. Pair it with {@link isTabVisible} for anything that must not render
 * a hidden tab.
 */
export function permittedLayoutTabs(
  layout: ResolvedLayout,
  ctx: TabVisibilityContext
): ResolvedLayoutTab[] {
  return layout.tabs.filter((tab) => isTabPermitted(tab, ctx))
}

/** The blocks of one tab this viewer may see, in render order. */
export function visibleTabBlocks(tab: ResolvedLayoutTab, ctx: TabVisibilityContext): LayoutBlock[] {
  return tab.blocks.filter((block) => ctx.isBlockVisible(block))
}
