// packages/lib/src/accounting/connect-and-go/client.ts

// Client-safe surface of the Connect-and-go setup steps: report and proposal shapes plus the pure
// bank-account planner. See plans/accounting/tasks/105-connect-and-go.md §4.

import type { AccountRole } from '../ledger/builders/entry'
import type { ExportSettings } from '../ledger/setup/export-settings'
import type { ChartImportResult } from '../ledger/types'
import type { ProviderCompanySettings } from '../providers/company-settings'
import type { ProposedCutover } from './cutover'

export {
  type BankAccountPlanInput,
  parseLast4FromName,
  planBankAccounts,
} from './bank-account-plan'
export {
  type CutoverSource,
  estimateDrainMinutes,
  type ProposedCutover,
  proposeCutover,
  RECOVERY_PER_LANE,
} from './cutover'

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

/** A prepare step that refused. The steps after it still ran. */
export interface ConnectAndGoFailure {
  step: 'company_settings' | 'chart' | 'rails' | 'provider_accounts' | 'bank_accounts' | 'roles'
  message: string
}

/** An unmapped role several provider accounts fit. */
export interface ConnectAndGoRoleQuestion {
  role: AccountRole
  /** Our accounts linked to those provider accounts; the picker offers these first. */
  candidateAccountIds: string[]
}

/** What `prepareConnectAndGo` did, and what only a person can answer. Nothing in it posted. */
export interface ConnectAndGoPrepareReport {
  preparedAt: string
  /** Setup was already finalized; the screen shows the outcome, not the questions. */
  finalized: boolean
  company: ProviderCompanySettings | null
  /** Proposed: the provider's fiscal year start, else the saved one. Written by Finish. */
  fiscalYearStartMonth: number
  /** Proposed: the saved book timezone, else the actor's; null when neither has one. Written by Finish. */
  bookTimeZone: string | null
  /** The saved export mode. */
  exportMode: ExportSettings['mode']
  proposedCutover: ProposedCutover
  chart: { mode: 'full' | 'refresh'; suggestionsLinked: number; result: ChartImportResult } | null
  /** Default accounts minted for roles the enabled posting types need and nothing in the chart fit. */
  rolesMinted: { role: AccountRole; glAccountId: string; name: string }[]
  rails: RailRouteReport | null
  /** Our accounts with no provider counterpart, created there on Finish; null when the provider cannot create. */
  providerAccountsToCreate: ProviderAccountToCreate[] | null
  bankAccounts: BankAccountPlan | null
  questions: {
    roles: ConnectAndGoRoleQuestion[]
    rails: RailRouteQuestion[]
    bankAccounts: BankAccountProposal[]
  }
  failures: ConnectAndGoFailure[]
}

/** One of our accounts Finish will create in the provider and link. */
export interface ProviderAccountToCreate {
  glAccountId: string
  name: string
  code: string | null
}

/** A person's answers to the prepare report's questions. */
export interface ConnectAndGoAnswers {
  roles?: { role: string; glAccountId: string }[]
  railBanks?: { paymentGatewayId: string; glAccountId: string }[]
  /** `BankAccountProposalKey`s the person accepted. */
  acceptBankAccounts?: string[]
  bookTimeZone?: string | null
  fiscalYearStartMonth?: number | null
  exportMode?: ExportSettings['mode'] | null
  /** `accounting.autoSend.*` and `accounting.summaryGrain.*` values; any other key is refused. */
  exportSettings?: { key: string; value: boolean | string }[]
}

export const CONNECT_AND_GO_COMPLETE_STEPS = [
  'cutover',
  'roles',
  'rail_banks',
  'bank_accounts',
  'provider_accounts',
  'book_connection',
  'opening',
  'finalize',
] as const

export type ConnectAndGoCompleteStep = (typeof CONNECT_AND_GO_COMPLETE_STEPS)[number]

export interface ConnectAndGoStepReport {
  step: ConnectAndGoCompleteStep
  status: 'done' | 'skipped' | 'failed'
  detail: string | null
}

/** What `completeConnectAndGo` did, step by step, up to the first refusal. */
export interface ConnectAndGoCompleteReport {
  completed: boolean
  steps: ConnectAndGoStepReport[]
  failedAt: ConnectAndGoCompleteStep | null
  message: string | null
  bankAccounts: BankAccountApplyReport | null
  /** Our accounts created in the provider and linked by this run. */
  providerAccounts: { created: number } | null
  bookConnection: BookConnectionSetupResult | null
  opening: { filledCount: number; differenceMinor: number; importedAccounts: number } | null
  finalize: { finalizedNow: boolean; openingStatus: string | null } | null
  /** Every setting this run can write, read back after it, so a client can refresh its copy. */
  settings: Record<string, unknown>
}

/** What the recovery sweeps would post after the cutover, and roughly what leaves for the provider. */
export interface ConnectAndGoBacklogPreview {
  cutoffPeriod: string
  bookTimeZone: string
  shipments: number
  movements: number
  /** Shipments parked at `price`: relieved, waiting for a standard cost (111 Q21). */
  relief: number
  /** Imported payments still to materialize into movements. */
  importedPayments: number
  exportMode: ExportSettings['mode']
  /** About how many provider objects the backlog exports as. */
  estimatedExports: number
  drainMinutes: number
}
