// packages/lib/src/accounting/ledger/chart/propose-role-account.ts

// PURE. The "New account" dialog's prefill for a role row - see
// plans/accounting/tasks/119-a-new-account-knows-its-role.md.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  ROLE_ACCOUNT_SUBTYPES,
  ROLE_ACCOUNT_TYPES,
} from '../builders/entry'
import type { ChartAccountRow } from '../types'
import type { GlAccountSubtypeValue } from './account-subtype'
import { CHART_PACKS, type GlAccountTypeValue, packForRole } from './default-chart'
import { nextAccountCode } from './next-account-code'

/** What the dialog opens with. Every field stays editable. */
export interface ProposedAccount {
  name: string
  code: string | null
  accountType: GlAccountTypeValue
  subtype: GlAccountSubtypeValue | null
  parentId: string | null
}

export interface ProposeRoleAccountOptions {
  /** The store, rail or currency the row overrides - appended to the name so it does not collide with the role's default account. */
  scopeLabel?: string
  /** The org's current role assignments; used to find a parent in an unnumbered chart. */
  roleAccounts?: readonly { role: string; accountId: string | null }[]
}

type ProposalChartRow = Pick<
  ChartAccountRow,
  'id' | 'code' | 'accountType' | 'subtype' | 'parentId' | 'isArchived'
>

/** A new account for `role`: our default chart's name, type and subtype, a code in the chart's own numbering, and the parent its neighbours share. */
export function proposeRoleAccount(
  role: AccountRole,
  chart: readonly ProposalChartRow[],
  options: ProposeRoleAccountOptions = {}
): ProposedAccount {
  const pack = packForRole(role)
  const template = pack ? CHART_PACKS[pack].accounts.find((row) => row.role === role) : undefined
  const accountType = template?.accountType ?? ROLE_ACCOUNT_TYPES[role]
  const subtype = template?.subtype ?? ROLE_ACCOUNT_SUBTYPES[role] ?? null
  const baseName = template?.name ?? ACCOUNT_ROLE_LABELS[role] ?? role
  const name = options.scopeLabel ? `${baseName} · ${options.scopeLabel}` : baseName

  const live = chart.filter((row) => !row.isArchived)
  const code = proposeCode(template?.code ?? null, accountType, subtype, live)
  const parentId = code
    ? parentFromNeighbour(code, accountType, live)
    : parentFromSiblingRole(role, pack, accountType, live, options.roleAccounts)

  return { name, code, accountType, subtype, parentId }
}

function numericCode(row: { code: string | null }): number | null {
  const code = row.code?.trim()
  return code && /^\d+$/.test(code) ? Number(code) : null
}

/** The most common digit count among numeric codes - how this org numbers. */
function dominantCodeLength(chart: readonly ProposalChartRow[]): number | null {
  const counts = new Map<number, number>()
  for (const row of chart) {
    const code = row.code?.trim()
    if (code && /^\d+$/.test(code)) counts.set(code.length, (counts.get(code.length) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [length, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = length
  }
  return best
}

function proposeCode(
  templateCode: string | null,
  accountType: GlAccountTypeValue,
  subtype: GlAccountSubtypeValue | null,
  chart: readonly ProposalChartRow[]
): string | null {
  // An unnumbered chart gets no code (`nextAccountCode`'s header).
  if (!chart.some((row) => row.code?.trim())) return null

  // Our default chart's band, when the org numbers the way we do: `4020` -> `4020-4099`.
  const start = templateCode ? Number(templateCode) : Number.NaN
  if (Number.isInteger(start) && templateCode?.length === dominantCodeLength(chart)) {
    const end = Math.floor(start / 100) * 100 + 99
    const code = nextAccountCode({ start, end, label: `${start}-${end}` }, chart)
    if (code.isOk() && code.value) return code.value
  }

  // A chart numbered its own way (QuickBooks' 5-digit `12100`): the next free
  // code after the highest same-type account, same-subtype ones first.
  const sameType = chart.filter((row) => row.accountType === accountType)
  const sameSubtype = subtype ? sameType.filter((row) => row.subtype === subtype) : []
  const peers = sameSubtype.some((row) => numericCode(row) !== null) ? sameSubtype : sameType
  const highest = peers.reduce<string | null>((best, row) => {
    const value = numericCode(row)
    if (value === null) return best
    return best === null || value > Number(best) ? row.code!.trim() : best
  }, null)
  if (!highest) return null

  const taken = new Set(chart.map((row) => row.code?.trim()).filter(Boolean))
  for (let candidate = Number(highest) + 1; ; candidate++) {
    const code = String(candidate)
    if (code.length !== highest.length) return null
    if (!taken.has(code)) return code
  }
}

/** The parent of the same-type account numbered just below `code` - the new account lands beside it. */
function parentFromNeighbour(
  code: string,
  accountType: GlAccountTypeValue,
  chart: readonly ProposalChartRow[]
): string | null {
  const target = Number(code)
  let neighbour: ProposalChartRow | null = null
  for (const row of chart) {
    if (row.accountType !== accountType) continue
    const value = numericCode(row)
    if (value === null || value >= target || row.code!.trim().length !== code.length) continue
    if (!neighbour || value > numericCode(neighbour)!) neighbour = row
  }
  return neighbour?.parentId ?? null
}

/** Unnumbered chart: the parent of the account another role in the same pack is mapped to. */
function parentFromSiblingRole(
  role: AccountRole,
  pack: ReturnType<typeof packForRole>,
  accountType: GlAccountTypeValue,
  chart: readonly ProposalChartRow[],
  roleAccounts: ProposeRoleAccountOptions['roleAccounts']
): string | null {
  if (!pack || !roleAccounts) return null
  const siblingRoles = new Set<string>(
    CHART_PACKS[pack].accounts.flatMap((row) => (row.role && row.role !== role ? [row.role] : []))
  )
  const byId = new Map(chart.map((row) => [row.id, row]))
  for (const assignment of roleAccounts) {
    if (!siblingRoles.has(assignment.role) || !assignment.accountId) continue
    const account = byId.get(assignment.accountId)
    if (account?.parentId && account.accountType === accountType) return account.parentId
  }
  return null
}
