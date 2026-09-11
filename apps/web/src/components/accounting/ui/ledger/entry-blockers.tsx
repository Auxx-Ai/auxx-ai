// apps/web/src/components/accounting/ui/ledger/entry-blockers.tsx

'use client'

import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  Ban,
  CircleSlash,
  CircleX,
  CloudOff,
  KeyRound,
  Landmark,
  Lock,
  Map as MapIcon,
  PackagePlus,
  PackageX,
  Scale,
  Settings2,
  Trash2,
  TriangleAlert,
  Unlink,
} from 'lucide-react'
import Link from 'next/link'
import type { ComponentType } from 'react'

/**
 * Every status this card can render a remedy for.
 *
 * ⚠️ Wider than `PostResultStatus` on purpose. `discard_refused`,
 * `bank_account_unmapped` and `no_bank_accounts` are NOT posting outcomes -
 * nothing was built, claimed or pushed - so putting them in the posting union
 * would make every exhaustive `switch` over a `PostResult` have to handle cases
 * that can never appear in one. They are refusals the SCREEN renders, which is
 * what this card is for (ground rule 9: every refusal is an `EntryBlockers`
 * card, never a toast).
 */
export type LedgerBlockerStatus =
  | PostResultStatus
  | 'discard_refused'
  | 'bank_account_unmapped'
  | 'no_bank_accounts'
  | 'suggestion_incomplete'
  | 'agreement_refused'
  | 'sync_refused'

/** One reason a preview, a post or a discard refused, as the console renders it. */
export interface LedgerBlocker {
  status: LedgerBlockerStatus
  error: string
}

interface BlockerRemedy {
  icon: ComponentType<{ className?: string }>
  title: string
  /** What to do about it, in the operator's terms. */
  guidance: string
  href?: string
  actionLabel?: string
  /** For the remedies that are a control on this page rather than another page. */
  action?: 'unlock' | 'next-period'
  /**
   * 🛑 `neutral` is not a softer `failure`. Two refusals here are the most
   * ORDINARY things an organization meets - a month in which nothing moved, and
   * a setup still in draft on day one - and a destructive box around either
   * teaches an operator that this screen alarms about nothing
   * (14-drive-the-close.md section 1.3). Only something actually broken is
   * `failure`.
   */
  tone: 'neutral' | 'failure'
}

/**
 * What each refusal means and where it is fixed.
 *
 * 🛑 Every status gets its own line with its own destination. A single generic
 * "preview failed" is what sends an operator to the logs for a string that is
 * already in the database (13-accounting-ui.md §5.2).
 */
const REMEDIES: Partial<Record<LedgerBlockerStatus, BlockerRemedy>> = {
  account_unmapped: {
    tone: 'failure',
    icon: MapIcon,
    title: 'An account role is not mapped',
    guidance:
      'A builder emits a role and the org chart maps it to an account code. The resolver fails closed on zero matches and on more than one, so the entry cannot be built until the named role points at exactly one account.',
    href: '/app/accounting/settings/accounts',
    actionLabel: 'Map the role',
  },
  period_closed: {
    tone: 'failure',
    icon: Lock,
    title: 'The period is locked',
    guidance:
      'Nothing may post into a month that has been declared shut. Unlocking permits posting into a month the accountant may already have seen, so it is a deliberate, named action rather than a toggle.',
    action: 'unlock',
    actionLabel: 'Review the lock',
  },
  unbalanced: {
    tone: 'failure',
    icon: Scale,
    title: 'The entry does not balance',
    guidance:
      'Debits and credits disagree, so the entry was refused before the period was claimed and nothing was written. The difference has to be found, never plugged.',
  },
  setup_incomplete: {
    tone: 'neutral',
    icon: Settings2,
    title: 'Finish the accounting setup first',
    guidance:
      'The opening baseline, the book time zone and the absorption rates are what the month-end arithmetic is computed from. The message above names exactly which rows are still blank. Nothing was written.',
    href: '/app/accounting/settings/general',
    actionLabel: 'Finish setup',
  },
  nothing_to_close: {
    tone: 'neutral',
    icon: CircleSlash,
    title: 'Nothing moved this month',
    guidance:
      'Every inventory balance and activity total is unchanged, so there is no month-end entry to build. This is a skip, not a fault: an organization whose cutoff predates its first movement walks through a run of these.',
    action: 'next-period',
    actionLabel: 'Go to the next month',
  },
  // 🛑 `failure`, not `neutral`, and not because anything broke. Unlike an empty
  // month or a day-one setup, this is a set of books that is genuinely short:
  // closing on top of it puts revenue permanently outside a month somebody has
  // certified, because the entry it owes can no longer be written into a locked
  // period. It is work to do, and the box has to say so.
  revenue_incomplete: {
    tone: 'failure',
    icon: PackagePlus,
    title: 'This month still holds revenue that is not in the books',
    guidance:
      'A shipment that has left with no posting behind it, or a credit memo the sales channel sent that nobody has issued or voided. The message above counts both. Post the fulfillments and settle the drafts first: once the month is closed, the entries they owe cannot be written into it.',
    href: '/app/orders',
    actionLabel: 'Open orders',
  },
  error: {
    tone: 'failure',
    icon: TriangleAlert,
    title: 'The entry could not be built',
    guidance:
      'Something failed that is not one of the named refusals. The reason is above, verbatim, so it can be acted on without reading the logs.',
  },
  disabled: {
    tone: 'neutral',
    icon: Ban,
    title: 'Export to the accounting system is switched off',
    guidance:
      'The entry is still built, balanced and persisted here. Only the push to the provider is off, and it is a setting somebody can flip.',
  },
  not_connected: {
    tone: 'neutral',
    icon: KeyRound,
    title: 'No accounting system is connected',
    guidance:
      'This is not a blocker. The entry is built, balanced and persisted identically with no provider at all.',
  },
  // ── HANDOFF slot 1B: the two statuses added by 1A's `inventory_role_refused`
  // / `account_invalid` (types.ts, already present per 0B/9a) ────────────────
  inventory_role_refused: {
    tone: 'failure',
    icon: PackageX,
    title: 'This entry names an inventory account',
    guidance:
      'A manual or opening entry may never write to an inventory-role account - that balance is owned by the append-only stock movement ledger and asserted only by the month-end close. Adjust inventory through a stock movement, or remove the row naming it.',
    href: '/app/accounting',
    actionLabel: 'Open the close console',
  },
  account_invalid: {
    tone: 'failure',
    icon: CircleX,
    title: 'An account on this entry is not valid',
    guidance:
      'The account named on this row does not exist in the chart, or is archived or inactive. The message above names the row - fix it there.',
  },
  // ── Banking a deposit: the account it is banked INTO ──────────────────────
  //
  // 🛑 Two different missing things with two different sentences. "You have no
  // bank accounts" on day one is ordinary setup and stays `neutral`; a bank
  // account that exists but has never been joined to the chart is a real
  // half-finished mapping, and the deposit it blocks would otherwise post
  // against whichever asset code the operator guessed at.
  no_bank_accounts: {
    tone: 'neutral',
    icon: Landmark,
    title: 'No bank account has been set up yet',
    guidance:
      'Money is banked INTO an account, so one has to exist before a deposit can name it. Connect a feed or add the account by hand - either is enough, and a manual account never needs a connection.',
    href: '/app/accounting/settings/bank-accounts',
    actionLabel: 'Add a bank account',
  },
  bank_account_unmapped: {
    tone: 'failure',
    icon: Unlink,
    title: 'That bank account has no ledger account',
    guidance:
      'A bank account is the real account at the bank; its ledger account is where that money is counted in the books. Until the two are joined, a deposit into it has nothing to debit - and the bank feed already posts against the mapping, so a guess here would put the deposit and its own statement line in different accounts. It is one field on the account.',
    href: '/app/accounting/settings/bank-accounts',
    actionLabel: 'Map the account',
  },
  // ── Task 09: discarding a draft ───────────────────────────────────────────
  //
  // 🛑 A refusal here names a POSTED entry and points at reversal, which is
  // exactly the kind of sentence that must not vanish in four seconds. Nothing
  // was changed, so the entry is still where it was.
  discard_refused: {
    tone: 'failure',
    icon: Trash2,
    title: 'This entry cannot be discarded',
    guidance:
      'Only a draft can be thrown away, and only one that has not reached the ledger. An entry that has been posted is corrected by reversing it and posting a new one, so what it did to the books stays on the record. Nothing was changed.',
  },
  // Brief 19 section 4.4: a provider suggestion that does not balance is not
  // a refusal. Nothing was built, claimed or posted, and every cell stays
  // editable. `neutral`, because the two reasons it happens (an account
  // QuickBooks has that the chart does not, and an inventory count not yet
  // entered) are ordinary setup work, not faults.
  suggestion_incomplete: {
    tone: 'neutral',
    icon: Scale,
    title: 'The suggestion does not balance yet',
    guidance:
      'What is still missing is below, with its amount. Nothing has been posted and every cell in the grid can be edited.',
  },
  // plans/accounting/tasks/20-two-authors-one-ledger.md §8.2. Nothing in the
  // schema enforces that the provider link is one-to-one, so two of our accounts
  // can claim the same QuickBooks account - and there is then no single figure
  // to compare that account against. A refusal naming both, never a guess about
  // which one the money belongs to.
  agreement_refused: {
    tone: 'failure',
    icon: Unlink,
    title: 'The two charts cannot be lined up',
    guidance:
      'One account in the connected system is claimed by more than one account in this chart, so its balance has no single counterpart here. Withdraw one of the two mappings on the account map and check again. Nothing was changed.',
    href: '/app/accounting/settings/accounts',
    actionLabel: 'Open the account map',
  },
  // plans/accounting/tasks/20-two-authors-one-ledger.md §7.4. The INBOUND sync
  // refused before it walked - most often the cutover floor (§5.4), which names
  // both the date that was asked for and the earliest the sync may read. That
  // floor is what stops brief 19's opening entry being imported a second time
  // and the whole opening position doubling, so its message is the remedy and
  // is carried verbatim.
  sync_refused: {
    tone: 'failure',
    icon: CloudOff,
    title: 'The sync did not run',
    guidance:
      'Nothing was read and nothing was written - the refusal happened before the first request went out. The reason above names the dates or the setting involved. A range the sync may not read is never quietly moved to one it may.',
  },
}

const FALLBACK: BlockerRemedy = {
  tone: 'failure',
  icon: TriangleAlert,
  title: 'The entry could not be built',
  guidance: 'The reason is below, verbatim, so it can be acted on without reading the logs.',
}

/** Neutral reads like the rest of the page; only a fault gets the destructive box. */
const TONE_CLASS: Record<BlockerRemedy['tone'], string> = {
  neutral: 'border-border bg-muted/40',
  failure: 'border-destructive/40 bg-destructive/5',
}

const TONE_ICON_CLASS: Record<BlockerRemedy['tone'], string> = {
  neutral: 'text-muted-foreground',
  failure: 'text-destructive',
}

interface EntryBlockersProps {
  blockers: LedgerBlocker[]
  /** Invoked by the `period_closed` remedy's "Review the lock" button. */
  onReviewLock?: () => void
  /** Invoked by the `nothing_to_close` remedy. Absent on the newest month. */
  onNextPeriod?: () => void
  /**
   * `period_closed`'s SECOND remedy - "post to the next open period instead",
   * per HANDOFF slot 1B. Deliberately a distinct prop from {@link onNextPeriod}
   * rather than reusing it: the ledger page's `onNextPeriod` NAVIGATES to
   * another month (`nothing_to_close`'s remedy, where "this month" has no entry
   * at all), while this one RE-DATES the entry on screen - the JE drawer is the
   * only caller that supplies it, and passing both would be wrong on the
   * month-end console's own `period_closed` card, which has no entry to re-date.
   */
  onPostToNextPeriod?: () => void
}

/**
 * Why this month cannot be posted, at the SAME visual weight as the entry.
 *
 * ⚠️ Not a warning strip above the entry. When a close is refused, the refusal
 * IS the screen's content: an operator who has to hunt for a thin yellow bar to
 * find out why the Post button does nothing has been given a puzzle instead of a
 * task (13-accounting-ui.md §5.2).
 */
export function EntryBlockers({
  blockers,
  onReviewLock,
  onNextPeriod,
  onPostToNextPeriod,
}: EntryBlockersProps) {
  if (blockers.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      {blockers.map((blocker) => {
        const remedy = REMEDIES[blocker.status] ?? FALLBACK
        const Icon = remedy.icon
        return (
          <div
            key={`${blocker.status}-${blocker.error}`}
            className={cn(
              'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start',
              TONE_CLASS[remedy.tone]
            )}>
            <Icon className={cn('mt-0.5 size-5 shrink-0', TONE_ICON_CLASS[remedy.tone])} />
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{remedy.title}</span>
                <span className='font-mono text-xs text-muted-foreground'>{blocker.status}</span>
              </div>
              {/* The server's own text, verbatim: on `account_unmapped` it names
                  every offending role, and on an uncosted movement it names the
                  row. Paraphrasing it here would throw away the only part that
                  identifies what to go and fix. */}
              <p className='text-sm'>{blocker.error}</p>
              <p className='text-xs text-muted-foreground'>{remedy.guidance}</p>
            </div>
            {remedy.href && remedy.actionLabel && (
              <Button asChild variant='outline' size='sm' className='shrink-0'>
                <Link href={remedy.href}>{remedy.actionLabel}</Link>
              </Button>
            )}
            {remedy.action === 'unlock' && onReviewLock && (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onReviewLock}>
                {remedy.actionLabel}
              </Button>
            )}
            {blocker.status === 'period_closed' && onPostToNextPeriod && (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onPostToNextPeriod}>
                Post to the next open period
              </Button>
            )}
            {remedy.action === 'next-period' && onNextPeriod && (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onNextPeriod}>
                {remedy.actionLabel}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
