// packages/lib/src/accounting/connect-and-go/bank-account-plan.ts

// Pure: which `bank_account` records to propose for the chart's bank accounts. Client-safe.

import type { BankAccountRow } from '../banking/client'
import type { ChartAccountRow } from '../ledger/types'
import type { BankAccountPlan, BankAccountPlanNote, BankAccountProposal } from './client'

/** Everything the planner reads, already loaded. */
export interface BankAccountPlanInput {
  /** Live chart accounts. */
  chart: readonly Pick<ChartAccountRow, 'id' | 'name' | 'subtype' | 'isActive'>[]
  /** `glAccountId -> providerAccountId` from the connected provider's mapping. */
  providerAccountIds: ReadonlyMap<string, string>
  /** Every `bank_account`, archived included. */
  bankAccounts: readonly Pick<
    BankAccountRow,
    'id' | 'name' | 'last4' | 'type' | 'glAccountId' | 'connectorId' | 'archivedAt'
  >[]
}

// A 4-digit run behind an account-number marker: "(1234)", "x1234", "...1234", "*1234", "ending in 1234".
const LAST4_PATTERN =
  /(?:\(\s*(?:x|\*+|\.{2,}|…)?|(?:^|\s)(?:x|\*+|#|\.{2,}|…)|ending(?:\s+in)?\s)\s*(\d{4})(?!\d)/gi

/** The account number's last four as written into an account name, or null when absent or ambiguous. */
export function parseLast4FromName(name: string): string | null {
  const found = new Set([...name.matchAll(LAST4_PATTERN)].map((match) => match[1] as string))
  return found.size === 1 ? ([...found][0] ?? null) : null
}

/**
 * Propose a `bank_account` per provider-linked bank-subtype account that has none, and a link for
 * each connected feed account whose last4 matches exactly one bank-subtype account, both ways.
 * An account a link is proposed for gets no create proposal: the feed account is its record.
 */
export function planBankAccounts(input: BankAccountPlanInput): BankAccountPlan {
  const bankGls = input.chart.filter((row) => row.subtype === 'bank' && row.isActive)
  const live = input.bankAccounts.filter((row) => !row.archivedAt)

  const hasAnyRecord = new Set(input.bankAccounts.map((row) => row.glAccountId).filter(Boolean))
  const hasConnected = new Set(
    live.filter((row) => row.connectorId && row.glAccountId).map((row) => row.glAccountId)
  )
  const manualOn = (glAccountId: string) =>
    live.filter((row) => !row.connectorId && row.glAccountId === glAccountId)

  const glLast4 = new Map<string, string | null>()
  for (const gl of bankGls) {
    const fromManual = new Set(
      manualOn(gl.id)
        .map((row) => row.last4?.trim())
        .filter(Boolean)
    )
    glLast4.set(
      gl.id,
      parseLast4FromName(gl.name) ?? (fromManual.size === 1 ? ([...fromManual][0] ?? null) : null)
    )
  }

  const unlinkedFeeds = live.filter((row) => row.connectorId && !row.glAccountId)
  const depositoryLast4 = unlinkedFeeds
    .filter((row) => row.type === 'depository')
    .map((row) => row.last4?.trim())

  const proposals: BankAccountProposal[] = []
  const notes: BankAccountPlanNote[] = []
  const linkedGlIds = new Set<string>()

  for (const feed of unlinkedFeeds) {
    const last4 = feed.last4?.trim() || null
    const note = (kind: BankAccountPlanNote['kind'], glAccountIds: string[] = []) =>
      notes.push({ kind, bankAccountId: feed.id, bankAccountName: feed.name, last4, glAccountIds })

    if (feed.type !== 'depository') {
      note('not_depository')
      continue
    }
    if (!last4) {
      note('no_last4')
      continue
    }
    const matches = bankGls.filter((gl) => !hasConnected.has(gl.id) && glLast4.get(gl.id) === last4)
    const peers = depositoryLast4.filter((value) => value === last4).length
    if (matches.length === 0) {
      note('no_match')
      continue
    }
    const gl = matches[0]
    if (matches.length > 1 || peers > 1 || !gl) {
      note(
        'ambiguous_last4',
        matches.map((row) => row.id)
      )
      continue
    }
    linkedGlIds.add(gl.id)
    proposals.push({
      key: `link:${feed.id}:${gl.id}`,
      kind: 'link',
      bankAccountId: feed.id,
      bankAccountName: feed.name,
      last4,
      glAccountId: gl.id,
      glAccountName: gl.name,
      manualBankAccountId: manualOn(gl.id)[0]?.id ?? null,
    })
  }

  for (const gl of bankGls) {
    const providerAccountId = input.providerAccountIds.get(gl.id)
    if (!providerAccountId || hasAnyRecord.has(gl.id) || linkedGlIds.has(gl.id)) continue
    proposals.push({
      key: `create:${gl.id}`,
      kind: 'create',
      glAccountId: gl.id,
      glAccountName: gl.name,
      providerAccountId,
      name: gl.name,
      last4: parseLast4FromName(gl.name),
    })
  }

  return { proposals, notes }
}
