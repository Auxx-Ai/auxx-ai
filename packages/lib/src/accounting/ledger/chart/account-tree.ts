// packages/lib/src/accounting/ledger/chart/account-tree.ts
//
// The chart's shape (plans/accounting/CHART-HIERARCHY.md §3, D1/D9). Pure and
// client-safe - no db import - so the web app builds the same tree
// `listChartAccounts` orders by. Every function takes the flat
// `ChartAccountRow[]` a caller already has; nothing here reads or caches.
//
// A dangling, self-referential, or cyclic `parentId` (data corruption, or an
// account whose parent was since archived) must never make a row disappear
// from the chart - every function below is guarded so a bad pointer degrades
// to "treated as top-level" rather than an infinite loop or a lost account.

import type { ChartAccountRow } from '../types'
import { accountLabel, compareAccountsByCodeThenName } from './account-label'

export interface AccountNode {
  account: ChartAccountRow
  depth: number
  children: AccountNode[]
}

function indexById(rows: readonly ChartAccountRow[]): Map<string, ChartAccountRow> {
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * Group rows by parent. A parent id that is absent, not in this row set
 * (archived, deleted, or from a different read), or equal to the row's own
 * id counts as no parent - the row is a root.
 */
function groupByParent(
  rows: readonly ChartAccountRow[],
  byId: Map<string, ChartAccountRow>
): { childrenByParent: Map<string, ChartAccountRow[]>; roots: ChartAccountRow[] } {
  const childrenByParent = new Map<string, ChartAccountRow[]>()
  const roots: ChartAccountRow[] = []
  for (const row of rows) {
    const parentId = row.parentId
    if (parentId && parentId !== row.id && byId.has(parentId)) {
      const siblings = childrenByParent.get(parentId) ?? []
      siblings.push(row)
      childrenByParent.set(parentId, siblings)
    } else {
      roots.push(row)
    }
  }
  return { childrenByParent, roots }
}

/**
 * D9: a parent, then its subtree, siblings ordered by code then name.
 *
 * A row cannot be reached from any root when its whole ancestry loops back on
 * itself (a cycle nowhere near a real top-level account) - that row still has
 * to render somewhere, so it becomes an extra top-level entry rather than
 * vanishing. The `visited` set is what turns the cycle into a plain chain: the
 * first node of the loop is placed as this extra root, and its cyclic
 * "parent" is placed once as its child, and nothing tries to walk the loop a
 * second time.
 */
export function buildAccountTree(rows: readonly ChartAccountRow[]): AccountNode[] {
  const byId = indexById(rows)
  const { childrenByParent, roots } = groupByParent(rows, byId)
  const visited = new Set<string>()

  function buildNode(row: ChartAccountRow, depth: number): AccountNode {
    visited.add(row.id)
    const children = (childrenByParent.get(row.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(compareAccountsByCodeThenName)
      .map((child) => buildNode(child, depth + 1))
    return { account: row, depth, children }
  }

  const nodes = roots
    .slice()
    .sort(compareAccountsByCodeThenName)
    .map((row) => buildNode(row, 0))

  const orphanedRoots = rows
    .filter((row) => !visited.has(row.id))
    .sort(compareAccountsByCodeThenName)
  for (const row of orphanedRoots) {
    if (visited.has(row.id)) continue // already swept in by an earlier orphan's own cycle
    nodes.push(buildNode(row, 0))
  }

  return nodes
}

/** D9's order, flattened depth-first. Still a flat array, so no consumer breaks. */
export function sortChartTree(rows: readonly ChartAccountRow[]): ChartAccountRow[] {
  const flat: ChartAccountRow[] = []
  const visit = (nodes: readonly AccountNode[]): void => {
    for (const node of nodes) {
      flat.push(node.account)
      visit(node.children)
    }
  }
  visit(buildAccountTree(rows))
  return flat
}

/**
 * Ancestors root-first, the account itself last. Empty when `id` is not in
 * `rows`. Stops rather than loops when the parent chain cycles back on itself.
 */
export function accountPath(rows: readonly ChartAccountRow[], id: string): ChartAccountRow[] {
  const byId = indexById(rows)
  const start = byId.get(id)
  if (!start) return []

  const path: ChartAccountRow[] = [start]
  const seen = new Set<string>([id])
  let current = start
  while (current.parentId) {
    if (seen.has(current.parentId)) break // cycle in the data - stop rather than loop forever
    const parent = byId.get(current.parentId)
    if (!parent) break
    path.unshift(parent)
    seen.add(parent.id)
    current = parent
  }
  return path
}

/**
 * `Sales: Product Income` (D8) - bare names for every ancestor, the full
 * `accountLabel` (code + name) for the leaf. Empty string when `id` is not
 * in `rows`.
 */
export function accountPathLabel(rows: readonly ChartAccountRow[], id: string): string {
  const path = accountPath(rows, id)
  if (path.length === 0) return ''
  const leaf = path[path.length - 1] as ChartAccountRow
  const ancestorNames = path.slice(0, -1).map((account) => account.name)
  return [...ancestorNames, accountLabel(leaf)].join(': ')
}

/**
 * Every id in `id`'s subtree, `id` itself excluded. Used for the editor's
 * parent-picker exclusion and the "live children" archive refusal.
 */
export function descendantIds(rows: readonly ChartAccountRow[], id: string): Set<string> {
  const byId = indexById(rows)
  const { childrenByParent } = groupByParent(rows, byId)
  const result = new Set<string>()

  const visit = (parentId: string, ancestors: ReadonlySet<string>): void => {
    const nextAncestors = new Set(ancestors).add(parentId)
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (nextAncestors.has(child.id)) continue // cycle in the data - stop rather than loop forever
      result.add(child.id)
      visit(child.id, nextAncestors)
    }
  }
  visit(id, new Set())
  return result
}

/** Root is 0. Empty (unknown `id`) also reads as 0. */
export function accountDepth(rows: readonly ChartAccountRow[], id: string): number {
  return Math.max(accountPath(rows, id).length - 1, 0)
}
