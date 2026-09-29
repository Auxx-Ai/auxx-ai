// apps/web/src/components/accounting/ui/settings/chart-tree.ts

import {
  type AccountNode,
  accountPath,
  buildAccountTree,
  type ChartAccountRow,
} from '@auxx/lib/accounting/ledger/client'

/**
 * One statement-type group's accounts as a tree, over `groupVisible` (the
 * archived toggle already applied, search not). With `matchedIds` (a search is
 * active), a match's ancestors stay in the tree even when their own text does
 * not match, so the indent still reads - the same rule
 * `gl-account-groups.ts`'s `accountsInGroup` follows. `null` means no search:
 * every visible account in the group renders.
 */
export function chartGroupTree(
  groupVisible: ChartAccountRow[],
  matchedIds: ReadonlySet<string> | null
): AccountNode[] {
  if (!matchedIds) return buildAccountTree(groupVisible)

  const keepIds = new Set<string>()
  for (const id of matchedIds) {
    for (const ancestor of accountPath(groupVisible, id)) keepIds.add(ancestor.id)
  }
  return buildAccountTree(groupVisible.filter((account) => keepIds.has(account.id)))
}

/**
 * Every account id in `nodes`, depth-first in the same order
 * `ChartAccountListRow` draws them - a search's non-matching ancestors
 * (kept by `chartGroupTree` for context) included. What the selection
 * store's Cmd+A and shift-range read, instead of the search-filtered list
 * alone, which drops exactly those ancestor rows even though they render
 * with a checkbox like everything else.
 */
export function flattenAccountIds(nodes: AccountNode[]): string[] {
  const ids: string[] = []
  const visit = (list: AccountNode[]) => {
    for (const node of list) {
      ids.push(node.account.id)
      visit(node.children)
    }
  }
  visit(nodes)
  return ids
}
