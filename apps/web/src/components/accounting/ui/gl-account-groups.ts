// apps/web/src/components/accounting/ui/gl-account-groups.ts

import {
  type AccountNode,
  accountPath,
  accountPathLabel,
  buildAccountTree,
  type ChartAccountRow,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
} from '@auxx/lib/accounting/ledger/client'
import { accountMatchesSearch } from '~/components/accounting/ui/account-label-format'

/** One row of a group's option list, in tree order (D9), with its indent level. */
export interface AccountGroupEntry {
  account: ChartAccountRow
  depth: number
}

/** One statement-classification section of the picker's option list. */
export interface AccountGroup {
  type: GlAccountTypeValue
  entries: AccountGroupEntry[]
}

function flattenAccountTree(nodes: readonly AccountNode[]): AccountGroupEntry[] {
  const flat: AccountGroupEntry[] = []
  for (const node of nodes) {
    flat.push({ account: node.account, depth: node.depth })
    flat.push(...flattenAccountTree(node.children))
  }
  return flat
}

/**
 * One type group's rows as a tree, filtered by search. A match is the account's
 * own code/name OR its {@link accountPathLabel} (D8); a matching account's
 * ancestors stay in the result too - real, selectable accounts kept only so the
 * indent still reads, per §7 "Picker".
 */
function accountsInGroup(rows: ChartAccountRow[], search: string): AccountGroupEntry[] {
  const flat = flattenAccountTree(buildAccountTree(rows))
  if (!search.trim()) return flat

  const matchedIds = rows
    .filter((account) => accountMatchesSearch(account, search, accountPathLabel(rows, account.id)))
    .map((account) => account.id)
  const visibleIds = new Set<string>()
  for (const id of matchedIds) {
    for (const ancestor of accountPath(rows, id)) visibleIds.add(ancestor.id)
  }
  return flat.filter((entry) => visibleIds.has(entry.account.id))
}

/**
 * Groups the chart in {@link GL_ACCOUNT_TYPES} (statement) order, applying
 * `filterTypes` and building each group's own tree (D3: a child always shares
 * its parent's type, so a group's rows are exactly what `buildAccountTree`
 * needs; an out-of-group parent - data corruption - degrades to that row
 * being its own root, the same way the tree builder treats any unknown
 * parent). Empty groups are dropped rather than rendered with a heading and
 * nothing under it.
 */
export function groupAccountsByType(
  accounts: ChartAccountRow[],
  filterTypes: GlAccountTypeValue[] | undefined,
  search: string
): AccountGroup[] {
  const allowed = filterTypes ? new Set(filterTypes) : null

  return GL_ACCOUNT_TYPES.filter((type) => !allowed || allowed.has(type))
    .map((type) => ({
      type,
      entries: accountsInGroup(
        accounts.filter((account) => account.accountType === type),
        search
      ),
    }))
    .filter((group) => group.entries.length > 0)
}
