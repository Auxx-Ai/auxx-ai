// packages/lib/src/accounting/reports/completeness.ts
//
// The completeness banner every statement view carries, per
// `plans/accounting/tasks/done/04-statements.md` §3: "report completeness is not
// report correctness." A balance sheet produced while a posting type the
// business relies on is switched off is arithmetically right and financially
// meaningless, and this read is what tells the reader so.
//
// 🛑 **What is NOT completeness: the export backlog.** This read used to append
// one item per row of `listFailedExports` - every entry posted here and not yet
// copied to the accounting provider - under the banner's own heading, "Not
// included in this report". That heading was false about every one of them: no
// statement read filters on `exportStatus`, so a pending or refused entry is in
// the books and in the figures, and the item's own sentence said as much
// directly underneath a title claiming the opposite. It was also unbounded and
// spanned every period, and `pending` is the RESTING state of every entry an
// org posts once the sync hold is on (`sync-queue-rows.ts`), so a healthy org
// got a banner reprinting its entire ledger, one button per row, on every
// statement and in every statement PDF.
//
// The outbound copy is the sync queue's subject (`?queue=` on the ledger page),
// which tallies the same rows by state and can act on them; the inbound half is
// `ProviderSyncMarker`'s. A statement says what is missing from ITS OWN
// figures, and nothing else.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { POSTING_POLICIES, POSTING_POLICY } from '../ledger/post/policy'
import { ENABLED_POSTING_TYPES } from '../ledger/roles/regime'
import { POSTING_TYPES, type PostingType } from '../ledger/types'

const logger = createScopedLogger('postings:reports:completeness')

/** One thing a statement does not (yet) reflect, with a link to do something about it. */
export interface CompletenessItem {
  id: string
  label: string
  /**
   * Where to go about it, when there IS somewhere.
   *
   * 🛑 Optional, and frequently absent. Every item used to carry
   * `{ label: 'View the ledger', href: '/app/accounting' }`, which was wrong for
   * all of them: a posting type is switched off by `enabled` on its policy - a
   * deploy - and no amount of looking at the ledger changes one. A button that
   * goes somewhere the reader cannot act is worse than no button, because it
   * costs a click to find that out. Point it at the page that EXPLAINS the item
   * (below) or leave it off.
   */
  remedy?: { label: string; href: string }
}

export interface Completeness {
  organizationId: string
  asOf: string
  /** One entry per posting type NOT in `ENABLED_POSTING_TYPES`, in words. */
  disabledPostingTypes: CompletenessItem[]
  /** Placeholder until the bank feed exists (`plans/bank-connection/`) - always empty for now. */
  unreviewedBankLines: CompletenessItem[]
  /** Placeholder until the bank feed exists - always empty for now. */
  coverageGaps: CompletenessItem[]
  /** All three buckets flattened, in display order - what `CompletenessBanner` renders directly. */
  items: CompletenessItem[]
}

export interface ReadCompletenessOptions {
  organizationId: string
  /** `YYYY-MM-DD` - the last date the statement covers, echoed back so a cached answer names its own subject. */
  asOf: string
}

/**
 * Posting types that are absent from {@link ENABLED_POSTING_TYPES} because a
 * CLOSE does not emit them, not because anything is switched off.
 *
 * 🛑 The disabled list below is `POSTING_TYPES - ENABLED_POSTING_TYPES`, and
 * that subtraction reads every absence as "somebody turned this off". For
 * `provider_sync` that is simply false: it is written by the inbound sync on the
 * accountant's schedule (brief 20 §6), never by a close, so it can never be in
 * `ENABLED_POSTING_TYPES` and a banner saying "provider sync posting is off"
 * would be a permanent, unfixable item on every org's statements. Subtracted
 * here rather than given a sentence, because there is nothing to say.
 */
const NEVER_CLOSE_EMITTED = new Set<PostingType>(['provider_sync'])

/**
 * One sentence per disabled posting type, naming what is consequently missing
 * from a statement - the brief's own example ("fulfillment posting is off, so
 * COGS is the monthly assertion").
 *
 * A DERIVED VIEW of `POSTING_POLICY` since brief 28 unit 1: each policy's
 * `disabledSentence`, the OFF-state pair of its `sentence`. Edit the policy,
 * not this table. `__tests__/policy.test.ts` pins every currently-disabled
 * type's sentence to the words this table held before it was derived.
 *
 * 🛑 `expense_bill` is deliberately NOT in `NEVER_CLOSE_EMITTED`. It is written
 * by auxx's own writer on a bill's Post action, exactly as `invoice_issued` is
 * written on an invoice's Send - so it belongs enabled on its policy, not
 * exempted from the subtraction here. `provider_sync` is exempt because NOTHING
 * in auxx ever emits it; that is not true of this one, and exempting it would
 * hide a real "the payable side of the books is switched off" from every
 * statement the day it is.
 */
export const DISABLED_POSTING_TYPE_SENTENCES: Partial<Record<PostingType, string>> =
  Object.fromEntries(POSTING_POLICIES.map((policy) => [policy.type, policy.disabledSentence]))

/**
 * The Posting settings section that EXPLAINS a type, which is as close to a
 * remedy as a switched-off posting type has: the page renders every policy, and
 * a disabled one wears a "Not counted as enabled" badge carrying the same
 * sentence this item does.
 *
 * Two anchors, because the page has two homes. A `never`-triggered type
 * (`receipt`, `vendor_bill`, `build`, both month-end helpers - every one of
 * today's items) is in the collapsed "Not posting" section rather than in the
 * body, so `#posting-<type>` would scroll to an element that is not on the page.
 */
function postingPolicyHref(type: PostingType): string {
  const anchor =
    POSTING_POLICY[type]?.trigger.kind === 'never' ? 'posting-never' : `posting-${type}`
  return `/app/accounting/settings/posting#${anchor}`
}

/**
 * Every completeness item the org's statements currently carry: the disabled
 * posting types, and the two bank-feed placeholders that stay empty until
 * `plans/bank-connection/` lands. NOT the export backlog - see the file header.
 *
 * ⚠️ `db` is unused TODAY. Every surviving bucket is derived from
 * `POSTING_POLICIES`, a module constant, so this answer is currently the same
 * for every org on a deploy. The parameter stays because the bank-feed buckets
 * above are the next thing to fill and both of them are per-org reads; taking
 * it out now would mean re-threading it through the router and the PDF renderer
 * to put it back. Fold the endpoint away instead if the feed ends up answering
 * from somewhere else.
 */
export async function readCompleteness(
  db: Database,
  options: ReadCompletenessOptions
): Promise<Result<Completeness, Error>> {
  const { organizationId, asOf } = options

  try {
    const enabled = new Set(ENABLED_POSTING_TYPES)
    const disabledPostingTypes: CompletenessItem[] = POSTING_TYPES.filter(
      (type) => !enabled.has(type) && !NEVER_CLOSE_EMITTED.has(type)
    ).map((type) => ({
      id: `disabled-posting-type:${type}`,
      label: DISABLED_POSTING_TYPE_SENTENCES[type] ?? `"${type}" posting is off.`,
      remedy: { label: 'Posting settings', href: postingPolicyHref(type) },
    }))

    // Bank-feed placeholders. Always empty until `plans/bank-connection/` ships
    // the review queue and the coverage record - see the file header.
    const unreviewedBankLines: CompletenessItem[] = []
    const coverageGaps: CompletenessItem[] = []

    return ok({
      organizationId,
      asOf,
      disabledPostingTypes,
      unreviewedBankLines,
      coverageGaps,
      items: [...disabledPostingTypes, ...unreviewedBankLines, ...coverageGaps],
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read statement completeness', { error, organizationId, asOf })
    return err(new AuxxError('Internal error'))
  }
}
