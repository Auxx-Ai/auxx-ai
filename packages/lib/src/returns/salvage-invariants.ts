// packages/lib/src/returns/salvage-invariants.ts

/**
 * Plan section 6.6's three invariants, as pure functions over a built tree.
 *
 * 1. **Only the highest `good` node in a branch produces a movement.** Walk
 *    down, stop at the first `good`. A `good` node under a `good` ancestor is
 *    one recovery, not two - the subassembly went into inventory whole, and
 *    restocking its children as well would put the same material back twice on
 *    an append-only ledger. This is the same one-level property
 *    `bom/subpart-graph.ts` documents for builds, which is why restocking the
 *    node the warehouse checked is coherent at every depth.
 * 2. **A parent's quantity bounds its children.** The split button divides a
 *    row; it must not invent units.
 * 3. **A `good` row whose part has no usable standard cost refuses**, naming
 *    the part.
 *
 * Every check returns a typed refusal in a `neverthrow` `err()` and throws
 * nothing, so the gated salvage writer (step 7) can report which part stopped
 * it without abandoning the rest of the return.
 */

import { err, ok, type Result } from 'neverthrow'
import { isUsableStandardCost } from './salvage-cost'
import {
  MissingStandardCostError,
  NestedGoodSalvageNodeError,
  SalvageQuantityExceedsAllowanceError,
} from './salvage-errors'
import { bomQuantity } from './salvage-tree'
import { ROOT_SALVAGE_KEY, type SalvageNode, type SubpartGraph } from './types'

// ─── Invariant 1: one recovery per branch ───────────────────────────

/**
 * The nodes that would produce a `return_in` movement.
 *
 * Walk down from each root and stop at the first `good` node: it is included
 * and its subtree is not searched. Anything else is descended into, because a
 * `damaged` subassembly may still contain a `good` bolt worth recovering.
 *
 * An unexpanded node (`children === null`) is a leaf as far as this walk is
 * concerned - by the laziness rule it has no rows beneath it, so there is
 * nothing under it to recover.
 */
export function selectSalvageMovementNodes(roots: readonly SalvageNode[]): SalvageNode[] {
  const out: SalvageNode[] = []
  const walk = (nodes: readonly SalvageNode[]) => {
    for (const node of nodes) {
      if (node.status === 'good') {
        out.push(node)
        continue
      }
      if (node.children) walk(node.children)
    }
  }
  walk(roots)
  return out
}

/**
 * The `good` nodes that sit beneath another `good` node, paired with the
 * ancestor that shadows them.
 *
 * These are **not** an error by themselves: {@link selectSalvageMovementNodes}
 * already ignores them, which is the plan's "one recovery, not two". The list
 * exists so a surface can grey them out or explain why ticking them changed
 * nothing.
 */
export function findShadowedGoodNodes(
  roots: readonly SalvageNode[]
): { node: SalvageNode; ancestor: SalvageNode }[] {
  const out: { node: SalvageNode; ancestor: SalvageNode }[] = []
  const walk = (nodes: readonly SalvageNode[], goodAncestor: SalvageNode | null) => {
    for (const node of nodes) {
      if (goodAncestor && node.status === 'good') out.push({ node, ancestor: goodAncestor })
      // The ancestor reported is the HIGHEST good one, not the nearest: that is
      // the node that actually produces the movement, so it is the one whose
      // recovery explains why this row changed nothing.
      const nextAncestor = node.status === 'good' ? (goodAncestor ?? node) : goodAncestor
      if (node.children) walk(node.children, nextAncestor)
    }
  }
  walk(roots, null)
  return out
}

/**
 * Refuse a tree that marks a `good` node under a `good` ancestor.
 *
 * Advisory: the salvage writer does not need it, because selection already
 * resolves the ambiguity. A surface that would rather tell the user than
 * silently drop half of what they ticked calls this first.
 */
export function checkNoNestedGoodNodes(
  roots: readonly SalvageNode[]
): Result<void, NestedGoodSalvageNodeError> {
  const shadowed = findShadowedGoodNodes(roots)
  const first = shadowed[0]
  if (!first) return ok(undefined)
  return err(
    new NestedGoodSalvageNodeError({
      nodeKey: first.node.key,
      ancestorKey: first.ancestor.key,
      partName: first.node.partName,
    })
  )
}

// ─── Invariant 2: a parent's quantity bounds its children ───────────

/** What {@link findQuantityAllowanceBreaches} needs to know the allowances. */
export interface SalvageQuantityBoundsInput {
  roots: readonly SalvageNode[]
  graph: SubpartGraph
  /** `return_line.part`, the BOM root. */
  rootPartId: string
  /** `return_line.quantity`, the top level's parent quantity. */
  returnLineQuantity: number
}

/**
 * Every place where sibling rows for one part add up to more than the parent
 * holds.
 *
 * ⚠️ **The bound is per part, against the BOM allowance** - not
 * `sum(children.quantity) <= parent.quantity`, which would refuse every real
 * tree, since a subassembly of 4 legitimately contains 16 bolts. The plan's
 * sentence is about the **split** button: splitting a row of 4 may produce
 * rows of 3 and 1, never 3 and 2. So the allowance for part `C` under parent
 * `P` is `bomQuantity(P.part, C) * P.quantity`, and the rows for `C` under `P`
 * must sum to no more than that.
 *
 * A part with no BOM edge under its parent - the BOM was edited after the row
 * was written - has no allowance to compare against and is skipped rather than
 * refused: the number to bound it by does not exist, and inventing one would
 * refuse a decision somebody already recorded.
 */
export function findQuantityAllowanceBreaches(
  input: SalvageQuantityBoundsInput
): SalvageQuantityExceedsAllowanceError[] {
  const out: SalvageQuantityExceedsAllowanceError[] = []

  const checkLevel = (
    siblings: readonly SalvageNode[],
    parentKey: string,
    parentPartId: string,
    parentQuantity: number
  ) => {
    const totals = new Map<string, { total: number; name: string }>()
    for (const node of siblings) {
      const entry = totals.get(node.partId) ?? { total: 0, name: node.partName }
      entry.total += node.quantity
      totals.set(node.partId, entry)
    }

    for (const [partId, entry] of totals) {
      const perParent = bomQuantity(input.graph, parentPartId, partId)
      if (perParent === null) continue
      const allowed = perParent * parentQuantity
      if (entry.total > allowed) {
        out.push(
          new SalvageQuantityExceedsAllowanceError({
            parentKey,
            partId,
            partName: entry.name,
            allowed,
            total: entry.total,
          })
        )
      }
    }

    for (const node of siblings) {
      if (node.children) checkLevel(node.children, node.key, node.partId, node.quantity)
    }
  }

  checkLevel(input.roots, ROOT_SALVAGE_KEY, input.rootPartId, input.returnLineQuantity)
  return out
}

/** {@link findQuantityAllowanceBreaches}, as a refusal on the first breach. */
export function checkSalvageQuantityBounds(
  input: SalvageQuantityBoundsInput
): Result<void, SalvageQuantityExceedsAllowanceError> {
  const breach = findQuantityAllowanceBreaches(input)[0]
  return breach ? err(breach) : ok(undefined)
}

// ─── Invariant 3: a salvaged part must be costed ────────────────────

/** What {@link findMissingStandardCosts} needs. Costs are minor units. */
export interface SalvageStandardCostInput {
  roots: readonly SalvageNode[]
  /** `part_standard_cost` per part id. A part absent from the map reads as null. */
  standardCosts: ReadonlyMap<string, number | null | undefined>
}

/**
 * Every part that would be salvaged and has no usable `part_standard_cost`.
 *
 * Runs over {@link selectSalvageMovementNodes}'s output, not the whole tree: a
 * `damaged` or `undecided` part writes no movement, so its cost is nobody's
 * problem. One entry per part, even when several rows salvage it, because the
 * fix is one edit to that part.
 */
export function findMissingStandardCosts(
  input: SalvageStandardCostInput
): MissingStandardCostError[] {
  const out: MissingStandardCostError[] = []
  const reported = new Set<string>()

  for (const node of selectSalvageMovementNodes(input.roots)) {
    if (reported.has(node.partId)) continue
    const cost = input.standardCosts.get(node.partId)
    if (isUsableStandardCost(cost)) continue
    reported.add(node.partId)
    out.push(
      new MissingStandardCostError({
        partId: node.partId,
        partName: node.partName,
        standardCost: cost ?? null,
      })
    )
  }

  return out
}

/** {@link findMissingStandardCosts}, as a refusal on the first uncosted part. */
export function checkSalvageStandardCosts(
  input: SalvageStandardCostInput
): Result<void, MissingStandardCostError> {
  const missing = findMissingStandardCosts(input)[0]
  return missing ? err(missing) : ok(undefined)
}

// ─── All three, in the order the writer wants them ──────────────────

/** {@link checkSalvageTree}'s input: both invariants that need outside data. */
export interface SalvageTreeCheckInput
  extends SalvageQuantityBoundsInput,
    SalvageStandardCostInput {
  /**
   * Refuse a `good` node nested under another instead of quietly selecting the
   * higher one. Off by default, matching the plan: nesting is resolved by
   * selection, not refusal.
   */
  refuseNestedGood?: boolean
}

/**
 * Apply all three invariants and return the nodes that would move stock.
 *
 * This is the single entry point the gated salvage writer (step 7) is meant to
 * call, so the three checks cannot be applied in different combinations by
 * different callers. It writes nothing and reads no database: the caller
 * supplies the standard costs and, on success, turns each returned node into
 * one `return_in` through the shared `writeStockMovements`.
 */
export function checkSalvageTree(
  input: SalvageTreeCheckInput
): Result<
  SalvageNode[],
  NestedGoodSalvageNodeError | SalvageQuantityExceedsAllowanceError | MissingStandardCostError
> {
  if (input.refuseNestedGood) {
    const nested = checkNoNestedGoodNodes(input.roots)
    if (nested.isErr()) return err(nested.error)
  }
  const bounds = checkSalvageQuantityBounds(input)
  if (bounds.isErr()) return err(bounds.error)
  const costs = checkSalvageStandardCosts(input)
  if (costs.isErr()) return err(costs.error)
  return ok(selectSalvageMovementNodes(input.roots))
}
