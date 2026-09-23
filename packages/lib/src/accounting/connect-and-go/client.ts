// packages/lib/src/accounting/connect-and-go/client.ts

// Client-safe surface of the Connect-and-go setup steps: report and proposal shapes plus the pure
// bank-account planner. See plans/accounting/tasks/105-connect-and-go.md §4.

export {
  type BankAccountPlanInput,
  parseLast4FromName,
  planBankAccounts,
} from './bank-account-plan'

/** The opening-policy reason recorded when setup activates the book connection itself. */
export const CONNECT_AND_GO_OPENING_REASON =
  'Set up by Connect and go: exports start the day after the cutover month.'

/** A rail `autoRouteRails` created. */
export interface RailRouteCreated {
  gatewayId: string
  name: string
  handles: string[]
  status: 'active' | 'closed'
  clearingAccountId: string
  feeAccountId: string | null
  /** The rail-scoped `bank` account, or null when it is a question. */
  bankAccountId: string | null
}

/** A rail group `autoRouteRails` left alone. */
export interface RailRouteSkipped {
  name: string
  handles: string[]
  reason: 'routed' | 'split'
  gatewayIds: string[]
}

/** An existing rail that had no `bank` of its own and got the single bank account. */
export interface RailRouteBanked {
  gatewayId: string
  bankAccountId: string
}

/** Something only a person can answer. */
export type RailRouteQuestion =
  | {
      kind: 'rail_bank'
      gatewayId: string
      name: string
      /** Every live bank-subtype account; empty when the chart has none. */
      candidateAccountIds: string[]
    }
  | {
      kind: 'rail_split'
      name: string
      gatewayIds: string[]
      unclaimedHandles: string[]
      /** The one gateway a merge would extend, or null when two gateways split the rail. */
      mergeInto: string | null
    }

/** A group whose set-up refused. The rest of the run carries on. */
export interface RailRouteFailed {
  name: string
  handles: string[]
  message: string
}

/** What `autoRouteRails` did. */
export interface RailRouteReport {
  created: RailRouteCreated[]
  banked: RailRouteBanked[]
  skipped: RailRouteSkipped[]
  questions: RailRouteQuestion[]
  failed: RailRouteFailed[]
}

/** What `activateBookConnectionForSetup` did. `activated: false` means a connection was already active. */
export interface BookConnectionSetupResult {
  activated: boolean
  connectionId: string
  exportFromDate: string
}

/** Stable across plan runs, so a UI can send a selection back. */
export type BankAccountProposalKey = `create:${string}` | `link:${string}:${string}`

/** A proposal from `planBankAccountsFromProvider`. Nothing is written until it is accepted. */
export type BankAccountProposal =
  | {
      key: `create:${string}`
      kind: 'create'
      /** The bank-subtype account the new `bank_account` points at. */
      glAccountId: string
      glAccountName: string
      /** Opaque provider id of the linked account. */
      providerAccountId: string
      name: string
      last4: string | null
    }
  | {
      key: `link:${string}:${string}`
      kind: 'link'
      /** The connected feed's `bank_account`, currently pointing at no account. */
      bankAccountId: string
      bankAccountName: string | null
      last4: string
      glAccountId: string
      glAccountName: string
      /** A manual `bank_account` already on that account, which the link makes redundant. */
      manualBankAccountId: string | null
    }

/** Why a connected feed account got no proposal. Information only. */
export interface BankAccountPlanNote {
  kind: 'no_last4' | 'no_match' | 'ambiguous_last4' | 'not_depository'
  bankAccountId: string
  bankAccountName: string | null
  last4: string | null
  /** The accounts that matched, for `ambiguous_last4`. */
  glAccountIds: string[]
}

export interface BankAccountPlan {
  proposals: BankAccountProposal[]
  notes: BankAccountPlanNote[]
}

/** What `applyBankAccountProposals` did with each accepted key. */
export interface BankAccountApplyReport {
  created: { key: BankAccountProposalKey; bankAccountId: string; glAccountId: string }[]
  linked: { key: BankAccountProposalKey; bankAccountId: string; glAccountId: string }[]
  /** Accepted keys the current state no longer proposes. */
  skipped: { key: string; reason: 'no_longer_applies' }[]
  failed: { key: BankAccountProposalKey; message: string }[]
}
