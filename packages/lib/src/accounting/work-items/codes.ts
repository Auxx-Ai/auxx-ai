// packages/lib/src/accounting/work-items/codes.ts

/** `INFO` waits for a wake, `WARNING` proceeds and stays visible, `ERROR` waits for a person (91 §4.6). */
export type WorkItemSeverity = 'info' | 'warning' | 'error'

/** What a row means to a person; `skipped` and `rejected` rows are never re-offered by the sweep. */
export type WorkItemStatus = 'waiting' | 'blocked' | 'warning' | 'skipped' | 'rejected'

/** Mirrors `ACCOUNTING_WORK_STAGES` in the schema, restated so this file stays client-safe. */
export type WorkItemStage = 'evidence' | 'money' | 'post' | 'issue'

/** The `sourceKind` values a work item names. */
export const WORK_ITEM_SOURCE_KINDS = [
  'money_transaction',
  'fulfillment',
  'credit_memo',
  'payout',
  'financial_source_acceptance',
] as const
export type WorkItemSourceKind = (typeof WORK_ITEM_SOURCE_KINDS)[number]

interface WorkItemCodeDef {
  severity: WorkItemSeverity
  status: WorkItemStatus
  /** Backs off from a minute instead of waiting for a wake. */
  transient?: boolean
  /** Rendered with the row's own keys; never stored. */
  sentence: (item: WorkItemSentenceInput) => string
}

export interface WorkItemSentenceInput {
  role?: string | null
  railId?: string | null
  glAccountId?: string | null
  periodKey?: string | null
  externalRef?: string | null
  detail?: Record<string, unknown> | null
}

function detailText(item: WorkItemSentenceInput, key: string): string | null {
  const value = item.detail?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The closed vocabulary. Adding a code means adding its sentence and severity here. */
export const WORK_ITEM_CODES = {
  ROLE_UNMAPPED: {
    severity: 'error',
    status: 'blocked',
    sentence: (item) => {
      const currency = detailText(item, 'currency')
      return item.role
        ? `The '${item.role}' posting role is not mapped to an account${currency ? ` for ${currency}` : ''}. Map it under Accounting > Settings > Accounts.`
        : 'A posting role is not mapped to an account. Map it under Accounting > Settings > Accounts.'
    },
  },
  ACCOUNT_INVALID: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      'A line names an account the chart no longer holds, or holds inactive. Repoint it in the chart of accounts.',
  },
  PERIOD_LOCKED: {
    severity: 'error',
    status: 'blocked',
    sentence: (item) =>
      item.periodKey
        ? `${item.periodKey} is closed. It posts once the period is reopened.`
        : 'Its period is closed. It posts once the period is reopened.',
  },
  UNBALANCED: {
    severity: 'error',
    status: 'blocked',
    sentence: () => 'The entry does not balance, so the ledger refused it.',
  },
  SETUP_INCOMPLETE: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      'Accounting setup is not finished (or the book time zone is not set). Finish the setup wizard.',
  },
  ENDPOINT_UNRESOLVED: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      'Where this money sits cannot be resolved. Map the payment gateway or cash account it moved through.',
  },
  MISSING_AMOUNT: {
    severity: 'error',
    status: 'blocked',
    sentence: () => 'The record carries no usable amount, so there is nothing to post.',
  },
  MISSING_DATE: {
    severity: 'error',
    status: 'blocked',
    sentence: () => 'The record carries no date to post against.',
  },
  NO_DOCUMENT: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      'The money is applied to neither an invoice nor an order, so there is no entry to post.',
  },
  SOURCE_NOT_FOUND: {
    severity: 'error',
    status: 'blocked',
    sentence: () => 'The record this work names no longer exists, or names no order.',
  },
  TOTALS_NOT_STAMPED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => 'The shipment totals are not stamped yet. It posts once they are.',
  },
  ORDER_NOT_FOUND: {
    severity: 'info',
    status: 'waiting',
    sentence: (item) =>
      item.externalRef
        ? `Order ${item.externalRef} has not arrived yet. It continues when the order syncs.`
        : 'Its order has not arrived yet. It continues when the order syncs.',
  },
  CUSTOMER_UNRESOLVED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => "The order's customer or currency is unresolved or does not match the money.",
  },
  ORDER_BALANCE_UNRESOLVED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => "The order's total is not known yet.",
  },
  RECEIPT_EXCEEDS_ORDER: {
    severity: 'info',
    status: 'waiting',
    sentence: () => 'The receipt is larger than what is left owing on its order.',
  },
  REFUND_ORIGINAL_UNRESOLVED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => 'The receipt or credit document this refund settles has not arrived yet.',
  },
  MOVEMENT_ALREADY_APPLIED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => 'The money is already applied, so new evidence cannot apply it again.',
  },
  CUSTOMER_CHANGED: {
    severity: 'info',
    status: 'waiting',
    sentence: () => "The source reports a different customer than the money's own.",
  },
  NOT_CONFIRMED: {
    severity: 'info',
    status: 'waiting',
    transient: true,
    sentence: () => 'The channel has not confirmed the transaction succeeded yet.',
  },
  MOVEMENT_CHANGED: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      'The source no longer reports the movement that was recorded. It needs an explicit correction.',
  },
  REFUND_CAPACITY_MISMATCH: {
    severity: 'error',
    status: 'blocked',
    sentence: () =>
      "The refund's amount, currency or customer does not fit the receipt and credit it settles.",
  },
  INVALID_EVIDENCE: {
    severity: 'error',
    status: 'rejected',
    sentence: (item) =>
      detailText(item, 'message') ?? 'The source transaction carries no usable identity or amount.',
  },
  REFUND_EXCEEDS_MEMO: {
    severity: 'warning',
    status: 'warning',
    sentence: () => 'The refund is larger than the credit memo it settles.',
  },
  NOTHING_TO_RECOGNISE: {
    severity: 'info',
    status: 'skipped',
    sentence: () => 'It is worth nothing or cancelled, so there is nothing to post.',
  },
  BEFORE_CUTOFF: {
    severity: 'info',
    status: 'skipped',
    sentence: (item) =>
      item.periodKey
        ? `It is dated in or before the opening cutoff (${item.periodKey}); the opening balance carries it.`
        : 'It is dated in or before the opening cutoff; the opening balance carries it.',
  },
  TRANSIENT_ERROR: {
    severity: 'error',
    status: 'blocked',
    transient: true,
    sentence: (item) =>
      detailText(item, 'message') ?? 'It failed unexpectedly; it is retried automatically.',
  },
  // Until a throw site carries its own code, the thrower's words ride in `detail.message`.
  REFUSED: {
    severity: 'error',
    status: 'blocked',
    sentence: (item) => detailText(item, 'message') ?? 'The poster refused it.',
  },
} satisfies Record<string, WorkItemCodeDef>

export type WorkItemCode = keyof typeof WORK_ITEM_CODES

export function isWorkItemCode(value: unknown): value is WorkItemCode {
  return typeof value === 'string' && Object.hasOwn(WORK_ITEM_CODES, value)
}

function codeDef(code: string): WorkItemCodeDef {
  return isWorkItemCode(code) ? WORK_ITEM_CODES[code] : WORK_ITEM_CODES.REFUSED
}

export function workItemSeverity(code: string): WorkItemSeverity {
  return codeDef(code).severity
}

export function workItemStatus(code: string): WorkItemStatus {
  return codeDef(code).status
}

export function workItemSentence(code: string, item: WorkItemSentenceInput = {}): string {
  return codeDef(code).sentence(item)
}

/** Backs off per attempt (from a minute to six hours) rather than waiting on a fixed delay. */
export function isTransientCode(code: string): boolean {
  return codeDef(code).transient === true
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * When the sweep offers a row again. Wakes are the mechanism; these delays are the
 * safety net for a fix no wake writer knows about.
 */
export function nextAttemptDelayMs(code: string, attempts: number): number | null {
  const def = codeDef(code)
  if (def.status === 'skipped' || def.status === 'rejected' || def.status === 'warning') return null
  if (def.transient) return Math.min(MINUTE_MS * 2 ** Math.max(0, attempts - 1), 6 * HOUR_MS)
  return def.severity === 'info' ? HOUR_MS : 24 * HOUR_MS
}
