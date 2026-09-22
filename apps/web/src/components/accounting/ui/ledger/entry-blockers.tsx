// apps/web/src/components/accounting/ui/ledger/entry-blockers.tsx

'use client'

import type {
  CloseBlockerItem,
  CloseBlockerItemKey,
  PostResultStatus,
} from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import { GridTreeRow, INDENT_REM } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  CircleSlash,
  CircleX,
  CloudOff,
  Landmark,
  Lock,
  Map as MapIcon,
  PackagePlus,
  PackageX,
  ReceiptText,
  Scale,
  Settings2,
  Trash2,
  TriangleAlert,
  Truck,
  Unlink,
} from 'lucide-react'
import Link from 'next/link'
import { type ComponentType, useState } from 'react'

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
  | 'export_refused'
  | 'export_blocked'

/** One reason a preview, a post or a discard refused, as the console renders it. */
export interface LedgerBlocker {
  status: LedgerBlockerStatus
  error: string
  /**
   * The refusal as the separate pieces of work it is made of, for the refusals
   * that HAVE pieces. Built in `packages/lib/src/accounting/ledger/periods/close-blockers.ts`,
   * which also assembles {@link error} out of these same items.
   *
   * 🛑 When this is present the card renders ONE ROW PER ITEM with its own
   * remedy, and does NOT also print `error` - the rows carry the same content,
   * generated from the same place, so printing both says everything twice.
   * That is only true because the items are DERIVED from the message rather
   * than written alongside it; a screen that hand-wrote its own labels here
   * would be paraphrasing a refusal, which is the one thing this card does not
   * do (13-accounting-ui.md §5.2).
   */
  items?: CloseBlockerItem[]
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
  // refused before it walked - the cutover floor (§5.4), a run already open, or
  // a queue that would not take the job. Only the first names a date, so the
  // guidance promises the message rather than what is in it.
  sync_refused: {
    tone: 'failure',
    icon: CloudOff,
    title: 'The sync did not run',
    guidance:
      'Nothing was read and nothing was written - the refusal happened before the first request went out. The reason above is the refusal itself, verbatim. A range the sync may not read is never quietly moved to one it may.',
  },
  // 89 D6/D7: the export's two halves of one refusal. `export_blocked` is what
  // the mapping table already knows before a send is spent; `export_refused` is
  // what the provider said after one was.
  export_refused: {
    tone: 'failure',
    icon: CloudOff,
    title: 'The provider refused this batch',
    guidance:
      'Your books are unchanged - the postings stay posted and the batch waits here. Fix what each row names, then retry it.',
  },
  export_blocked: {
    tone: 'failure',
    icon: Unlink,
    title: 'This batch cannot be sent yet',
    guidance:
      'The account map already says these accounts have no counterpart in the connected system, so a send would be refused. Nothing has been attempted.',
  },
}

const FALLBACK: BlockerRemedy = {
  tone: 'failure',
  icon: TriangleAlert,
  title: 'The entry could not be built',
  guidance: 'The reason is below, verbatim, so it can be acted on without reading the logs.',
}

/** What ONE outstanding piece of work offers, on its own row. */
interface ItemRemedy {
  icon: ComponentType<{ className?: string }>
  /** The button's words. An imperative, and short enough not to wrap. */
  actionLabel: string
  /** A destination, when the work is done on another page. */
  href?: (item: CloseBlockerItem) => string
  /**
   * The work is done in a control THIS page owns (a batch posting dialog), so
   * the row reports the click through `onFix` and the host decides what opens.
   * The card stays presentational: mounting a dialog from in here would put a
   * preview query behind every refusal that merely mentions one.
   */
  fix?: boolean
}

/** The Chart tab's editor pane, seeded with one account. */
function chartAccountHref(glAccountId: string | undefined): string {
  return glAccountId
    ? `/app/accounting/settings/accounts?s=chart&account=${encodeURIComponent(glAccountId)}`
    : '/app/accounting/settings/accounts?s=chart'
}

/**
 * The items whose remedy is a control the HOST page mounts, so the host can
 * switch on the key it is handed without widening it back to every item.
 *
 * ⚠️ Written out rather than derived from {@link ITEM_REMEDIES}: that map is
 * annotated `Record<CloseBlockerItemKey, ItemRemedy>`, which widens `fix: true`
 * to `boolean` and leaves a conditional type nothing to select on. The two are
 * held in step by `entry-blockers.test.ts`, which fails when a `fix: true` item
 * is added here and not there.
 */
export type FixableBlockerItemKey = 'unposted_shipments'

/**
 * Where each piece of work is actually done.
 *
 * 🛑 One destination per ITEM, not one per refusal. `revenue_incomplete` is
 * three independent jobs fixed in three different places, and the card that
 * offered a single "Open orders" button for all three sent an operator to the
 * right screen for at most one of them.
 */
export const ITEM_REMEDIES: Record<CloseBlockerItemKey, ItemRemedy> = {
  unposted_shipments: { icon: Truck, actionLabel: 'Post fulfillments', fix: true },
  // ⚠️ The unfiltered list, deliberately. `RecordsView` reads only `create` and
  // the selected row id from the query string, so a `?status=draft&month=…`
  // here would look like a filter and do nothing. The row's own label says how
  // many there are and its remedy says which month.
  draft_channel_memos: {
    icon: ReceiptText,
    actionLabel: 'Review drafts',
    href: () => '/app/credit-memos',
  },
  unmapped_role: {
    icon: MapIcon,
    actionLabel: 'Map role',
    href: (item) =>
      item.ref
        ? `/app/accounting/settings/accounts?role=${encodeURIComponent(item.ref)}`
        : '/app/accounting/settings/accounts',
  },
  // 🛑 The Chart tab, not the Mapping tab the role rows above go to. `?s=chart`
  // is what `accounts-settings-page.tsx` reads before `?account=`, and an
  // account id without it lands on Mapping and selects nothing (89 §1.6).
  unmapped_account: {
    icon: MapIcon,
    actionLabel: 'Map account',
    href: (item) => chartAccountHref(item.ref),
  },
  invalid_mapping: {
    icon: Unlink,
    actionLabel: 'Re-map account',
    href: (item) => chartAccountHref(item.ref),
  },
  // The three checks a close is, now that it posts nothing (MIGRATION step 5):
  // a document whose entry never landed, the ledger disagreeing with the rows
  // themselves, and the ledger disagreeing with the parts list (73 §6.2 rule 4).
  inventory_unposted: {
    icon: PackagePlus,
    actionLabel: 'Open movements',
    href: () => '/app/records/stock_movement',
  },
  inventory_balance: {
    icon: Scale,
    actionLabel: 'Open the trial balance',
    href: () => '/app/accounting/reports/trial-balance',
  },
  // The parts list is where this one is answered: the shelf's quantity times
  // its standard is what the accounts are being checked against.
  inventory_standard_value: {
    icon: Scale,
    actionLabel: 'Open parts',
    href: () => '/app/records/part',
  },
}

interface EntryBlockersProps {
  blockers: LedgerBlocker[]
  /**
   * A row's own remedy was clicked, for the items whose remedy is a control on
   * the HOST page rather than another page (the two batch posting dialogs).
   *
   * 🛑 The card never mounts a dialog itself. `BatchPostingDialog` runs a
   * preview query as soon as it mounts, and this card appears on six surfaces -
   * a deposit panel, a bank match panel, the journal entry drawer and the
   * opening balance page among them - none of which should pay for a
   * fulfillment preview because a refusal happened to mention one.
   */
  onFix?: (item: CloseBlockerItem) => void
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
  /**
   * `bare` drops the framed card and starts each row CLOSED, for a host that has
   * already named the refusal on a row of its own and nests these under it (the
   * ledger closeout). Everywhere else the card is the whole statement of what
   * went wrong and stays framed and open.
   */
  variant?: 'card' | 'bare'
  /** Indent, for a `bare` list nested under the host's own row. */
  depth?: number
}

/** Both levels share a grid, so every remedy button lands at the same x. */
const COLUMNS = 'minmax(0,1fr) auto'

/**
 * Why this month cannot be posted, as a list of the work it is waiting on.
 *
 * ⚠️ Not a warning strip above the entry. When a close is refused, the refusal
 * IS the screen's content: an operator who has to hunt for a thin yellow bar to
 * find out why the Post button does nothing has been given a puzzle instead of a
 * task (13-accounting-ui.md §5.2).
 *
 * ## Why a tree and not a paragraph
 *
 * A refusal is frequently several jobs wearing one status. `revenue_incomplete`
 * is up to three - unposted shipments, draft channel memos, issued memos nobody
 * has posted - and `account_unmapped` is one per offending role. As one Alert
 * they were one paragraph with one button, and the button could only ever point
 * at one of them. Each is now its own row under the status it belongs to, with
 * the remedy for THAT row next to it.
 *
 * A refusal that is genuinely one indivisible thing (`unbalanced`,
 * `period_closed`, every banking refusal) carries no items and renders as it
 * always did: one row, the server's sentence verbatim, one button.
 */
export function EntryBlockers({
  blockers,
  onFix,
  onReviewLock,
  onNextPeriod,
  onPostToNextPeriod,
  variant = 'card',
  depth = 0,
}: EntryBlockersProps) {
  if (blockers.length === 0) return null

  // 🛑 The tone is the WORST blocker's, and it lives on the container rather
  // than on each row. `neutral` is not a softer `failure`: an empty month and a
  // day-one setup are the most ordinary things an organization meets, and a
  // destructive box around either teaches an operator that this screen alarms
  // about nothing (14-drive-the-close.md section 1.3).
  const hasFailure = blockers.some(
    (blocker) => (REMEDIES[blocker.status] ?? FALLBACK).tone === 'failure'
  )

  const rows = blockers.map((blocker) => (
    <BlockerRows
      key={`${blocker.status}-${blocker.error}`}
      blocker={blocker}
      depth={depth}
      defaultOpen={variant === 'card'}
      onFix={onFix}
      onReviewLock={onReviewLock}
      onNextPeriod={onNextPeriod}
      onPostToNextPeriod={onPostToNextPeriod}
    />
  ))

  // No `role='alert'` on the bare variant: the host row that carries the
  // refusal's name owns that, and two alerts for one refusal announce it twice.
  if (variant === 'bare') return <div className='flex w-full flex-col'>{rows}</div>

  return (
    <div
      role='alert'
      className={cn(
        'flex w-full flex-col rounded-2xl border px-1 py-1',
        hasFailure
          ? 'border-destructive/50 bg-destructive/5 dark:border-destructive'
          : 'bg-muted/40'
      )}>
      {rows}
    </div>
  )
}

/**
 * One refusal: a row naming it, and its work underneath.
 *
 * Open by default in the `card` variant, where the card IS the statement of what
 * went wrong and has nothing to gain from a chevron. `bare` starts closed: the
 * host row above already names the refusal and carries the count.
 */
function BlockerRows({
  blocker,
  depth = 0,
  defaultOpen = true,
  onFix,
  onReviewLock,
  onNextPeriod,
  onPostToNextPeriod,
}: {
  blocker: LedgerBlocker
  depth?: number
  defaultOpen?: boolean
  onFix?: (item: CloseBlockerItem) => void
  onReviewLock?: () => void
  onNextPeriod?: () => void
  onPostToNextPeriod?: () => void
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const remedy = REMEDIES[blocker.status] ?? FALLBACK
  const items = blocker.items ?? []
  const Icon = remedy.icon

  // The card-level remedy, for a refusal that is ONE thing. A refusal made of
  // items has a button per item instead, and a second generic one beside the
  // title would compete with every one of them.
  const cardAction =
    items.length > 0 ? null : (
      <>
        {remedy.href && remedy.actionLabel && (
          <Button asChild variant='outline' size='sm'>
            <Link href={remedy.href}>{remedy.actionLabel}</Link>
          </Button>
        )}
        {remedy.action === 'unlock' && onReviewLock && (
          <Button variant='outline' size='sm' onClick={onReviewLock}>
            {remedy.actionLabel}
          </Button>
        )}
        {blocker.status === 'period_closed' && onPostToNextPeriod && (
          <Button variant='outline' size='sm' onClick={onPostToNextPeriod}>
            Post to the next open period
          </Button>
        )}
        {remedy.action === 'next-period' && onNextPeriod && (
          <Button variant='outline' size='sm' onClick={onNextPeriod}>
            {remedy.actionLabel}
          </Button>
        )}
      </>
    )

  return (
    <GridTreeRow
      columns={COLUMNS}
      depth={depth}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      icon={
        <Icon
          className={cn(
            'size-4',
            remedy.tone === 'failure' ? 'text-destructive' : 'text-muted-foreground'
          )}
        />
      }
      title={
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate font-medium text-foreground'>{remedy.title}</span>
          <span className='shrink-0 font-mono text-muted-foreground text-xs'>{blocker.status}</span>
        </span>
      }
      cells={[
        <div key='action' className='flex items-center justify-end gap-2 ps-2'>
          {cardAction}
        </div>,
      ]}>
      {/* The prose below is indented with `ps-6`, which clears the connector
          `BaseTreeRow` draws at the parent icon's center - but only at depth 0.
          Shifting the whole block by the parent's own indent keeps that true at
          any depth. */}
      <div className='flex flex-col' style={{ paddingLeft: `${depth * INDENT_REM}rem` }}>
        {/* The server's own text, verbatim, for a refusal with no items: on an
            uncosted movement it names the row and on `setup_incomplete` it names
            every blank setting. Paraphrasing it would throw away the only part
            that identifies what to go and fix. When there ARE items they are
            that same text, already split into the jobs it describes. */}
        {items.length === 0 && (
          <p className='pe-2 pt-1 pb-2 ps-6 text-foreground text-sm'>{blocker.error}</p>
        )}
        {items.map((item) => (
          <ItemRow key={`${item.key}-${item.ref ?? item.label}`} item={item} onFix={onFix} />
        ))}
        {/* `ps-6` clears the connector line `BaseTreeRow` draws at the parent
            icon's center (1.125rem): at `px-2` the line ran straight through
            the sentence. */}
        <p className='pe-2 pt-1 pb-2 ps-6 text-muted-foreground text-xs'>{remedy.guidance}</p>
      </div>
    </GridTreeRow>
  )
}

/** One piece of outstanding work, and the one button that does it. */
function ItemRow({
  item,
  onFix,
}: {
  item: CloseBlockerItem
  onFix?: (item: CloseBlockerItem) => void
}) {
  const remedy = ITEM_REMEDIES[item.key]
  const Icon = remedy.icon

  return (
    <GridTreeRow
      depth={1}
      columns={COLUMNS}
      icon={<Icon className='size-4 text-muted-foreground' />}
      title={
        // Two lines, both visible. The remedy is the sentence the refusal was
        // stored with, and a tooltip would make an operator hover to find out
        // what to do - the same puzzle §5.2 is about, in miniature.
        <span className='flex min-w-0 flex-col py-1'>
          <span className='truncate text-foreground'>{item.label}</span>
          <span className='truncate text-muted-foreground text-xs'>{item.remedy}</span>
        </span>
      }
      cells={[
        <div key='action' className='flex items-center justify-end ps-2'>
          {remedy.href ? (
            <Button asChild variant='outline' size='sm'>
              <Link href={remedy.href(item)}>{remedy.actionLabel}</Link>
            </Button>
          ) : remedy.fix && onFix ? (
            <Button variant='outline' size='sm' onClick={() => onFix(item)}>
              {remedy.actionLabel}
            </Button>
          ) : null}
        </div>,
      ]}
    />
  )
}
