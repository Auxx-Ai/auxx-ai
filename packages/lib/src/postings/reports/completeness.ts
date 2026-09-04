// packages/lib/src/postings/reports/completeness.ts
//
// The completeness banner every statement view carries, per
// `plans/accounting/tasks/04-statements.md` §3: "report completeness is not
// report correctness." A balance sheet produced while a posting type the
// business relies on is switched off is arithmetically right and financially
// meaningless, and this read is what tells the reader so.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { periodMonth } from '../periods'
import { ENABLED_POSTING_TYPES } from '../regime'
import { POSTING_TYPES, type PostingType } from '../types'
import { listUnpostedPeriods, type UnpostedPeriod } from '../verify-balance'

const logger = createScopedLogger('postings:reports:completeness')

/** One thing a statement does not (yet) reflect, with a link to do something about it. */
export interface CompletenessItem {
  id: string
  label: string
  remedy: { label: string; href: string }
}

export interface Completeness {
  organizationId: string
  asOf: string
  unpostedPeriods: UnpostedPeriod[]
  /** One entry per posting type NOT in `ENABLED_POSTING_TYPES`, in words. */
  disabledPostingTypes: CompletenessItem[]
  /** Placeholder until the bank feed exists (`plans/bank-connection/`) - always empty for now. */
  unreviewedBankLines: CompletenessItem[]
  /** Placeholder until the bank feed exists - always empty for now. */
  coverageGaps: CompletenessItem[]
  /** All four buckets flattened, in display order - what `CompletenessBanner` renders directly. */
  items: CompletenessItem[]
}

export interface ReadCompletenessOptions {
  organizationId: string
  /** `YYYY-MM-DD`. Bounds `unpostedPeriods` to periods through this date's month. */
  asOf: string
}

/**
 * One sentence per disabled posting type, naming what is consequently missing
 * from a statement - the brief's own example ("fulfillment posting is off, so
 * COGS is the monthly assertion"), generalised to every type in the union so a
 * newly added type never falls through with no sentence.
 */
const DISABLED_POSTING_TYPE_SENTENCES: Partial<Record<PostingType, string>> = {
  fulfillment:
    'Fulfillment posting is off, so revenue and COGS come only from the monthly inventory assertion.',
  payout:
    'Payout posting is off, so Shopify and processor clearing accounts are not reconciled per payout.',
  receipt:
    'Per-event receipt posting is off, so inventory moves only through the monthly assertion.',
  vendor_bill:
    'Per-event vendor bill posting is off, so goods received not invoiced is not relieved per bill.',
  build: 'Build posting is off.',
  month_end_deferral: 'Month-end deferral posting is off.',
  month_end_reversal: 'Month-end reversal posting is off.',
  manual_journal: 'Manual journal entries are off, so a bookkeeper cannot post an adjusting entry.',
  opening_balance: 'The opening trial balance is off, so this ledger has no starting position.',
  bank_transaction: 'Bank feed posting is off, so no bank line has been coded to the books.',
  bank_deposit: 'Deposit posting is off, so undeposited funds is never cleared to cash.',
  write_off: 'Write-off posting is off.',
}

/**
 * Every completeness item the org's statements currently carry: unposted
 * periods (`listUnpostedPeriods`), the disabled posting types, and the two
 * bank-feed placeholders that stay empty until `plans/bank-connection/`
 * lands.
 */
export async function readCompleteness(
  db: Database,
  options: ReadCompletenessOptions
): Promise<Result<Completeness, Error>> {
  const { organizationId, asOf } = options

  try {
    const unpostedResult = await listUnpostedPeriods(db, organizationId, {
      through: periodMonth(asOf),
    })
    if (unpostedResult.isErr()) return err(unpostedResult.error)
    const unpostedPeriods = unpostedResult.value

    const enabled = new Set(ENABLED_POSTING_TYPES)
    const disabledPostingTypes: CompletenessItem[] = POSTING_TYPES.filter(
      (type) => !enabled.has(type)
    ).map((type) => ({
      id: `disabled-posting-type:${type}`,
      label: DISABLED_POSTING_TYPE_SENTENCES[type] ?? `"${type}" posting is off.`,
      remedy: { label: 'View the ledger', href: '/app/accounting' },
    }))

    const unpostedPeriodItems: CompletenessItem[] = unpostedPeriods.map((period) => ({
      id: `unposted-period:${period.glPostingId}`,
      label:
        period.status === 'failed'
          ? `${period.periodKey} failed to post: ${period.failureReason ?? 'no reason recorded'}.`
          : `${period.periodKey} is claimed but not yet posted.`,
      remedy: { label: 'Open the ledger', href: `/app/accounting/${period.periodKey}` },
    }))

    // Bank-feed placeholders. Always empty until `plans/bank-connection/` ships
    // the review queue and the coverage record - see the file header.
    const unreviewedBankLines: CompletenessItem[] = []
    const coverageGaps: CompletenessItem[] = []

    return ok({
      organizationId,
      asOf,
      unpostedPeriods,
      disabledPostingTypes,
      unreviewedBankLines,
      coverageGaps,
      items: [
        ...unpostedPeriodItems,
        ...disabledPostingTypes,
        ...unreviewedBankLines,
        ...coverageGaps,
      ],
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read statement completeness', { error, organizationId, asOf })
    return err(new AuxxError('Internal error'))
  }
}
