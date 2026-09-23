// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-detail.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Banknote,
  BookOpenCheck,
  CalendarClock,
  Clock,
  FileCheck,
  Landmark,
  Receipt,
  Scale,
} from 'lucide-react'
import Link from 'next/link'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { formatAccountingDate, formatAuditTimestamp, formatMinor } from '../../ledger/format'
import { LedgerCard } from '../../ledger-card'
import { formatEvidenceDate } from './evidence-format'
import { PayoutProviderSide } from './payout-provider-side'
import { ProcessorActivity } from './processor-activity'

/** Accounting > Settings > Payment gateways — where a feed is pointed at a rail. */
const PAYMENT_GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

/**
 * The body of the payout drawer: independent totals, source completeness and
 * the actions needed to resolve gaps.
 *
 * 🛑 It renders NO identity. The external id, the source account, the status
 * badges and the "Open connector" link live in `payout-evidence-drawer.tsx`'s
 * `DrawerHeader`, and repeating any of them here is what made the first block a
 * second header. Everything below is a flush `Section` or a self-padded child -
 * the scroll wrapper supplies neither padding nor gap.
 */
export function PayoutEvidenceDetail({ payoutId }: { payoutId: string }) {
  const query = api.payoutEvidence.detail.useQuery({ id: payoutId })
  const payout = query.data
  const { getSetting } = useSettings({})
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string | null) ?? 'UTC'

  if (query.error) {
    return (
      <div className='p-3'>
        <Alert variant='destructive'>
          <AlertTitle>Could not load payout</AlertTitle>
          <AlertDescription>
            {query.error.message} Use Refresh evidence to try again.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!payout) {
    return (
      <div className='p-3'>
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  const sourceAmount = (amount: string) => formatMinor(Number(amount), payout.sourceCurrency)

  return (
    <>
      {/* 🛑 The dates and the destination amount are CELLS here, not a `Details`
          section under the grid. They were a `<dl>` of six rows that restated
          what the three money cards above it already said, and a reader had to
          cross a section border to compare a payout's amount with its date. Six
          cells, two complete rows: the reconciliation story (reported, less
          constituent, equals difference) on the first, what the provider filed
          on the second. `MetricGrid` leaves a divider-coloured gap on a partial
          row, so the count is deliberate. */}
      <MetricGrid columns={3}>
        <MetricCell
          label='Reported payout'
          icon={<Landmark className='size-4 text-muted-foreground' />}
          value={
            <span className='font-mono tabular-nums'>{sourceAmount(payout.sourceAmountMinor)}</span>
          }
          description='The amount independently reported by the provider'
        />
        <MetricCell
          label='Constituent net'
          icon={<FileCheck className='size-4 text-muted-foreground' />}
          value={
            <span className='font-mono tabular-nums'>
              {payout.constituentNetMinor === null
                ? 'Not assessed'
                : sourceAmount(payout.constituentNetMinor)}
            </span>
          }
          description='Processor activity, excluding the outgoing payout'
        />
        <MetricCell
          label='Difference'
          icon={<Scale className='size-4 text-muted-foreground' />}
          value={
            <span className='font-mono tabular-nums'>
              {payout.differenceMinor === null
                ? 'Not assessed'
                : sourceAmount(payout.differenceMinor)}
            </span>
          }
          description='Reported payout less constituent net; incomplete evidence cannot establish agreement'
        />
        <MetricCell
          label='Reported destination'
          icon={<Banknote className='size-4 text-muted-foreground' />}
          value={
            <span className='font-mono tabular-nums'>
              {formatMinor(Number(payout.destinationAmountMinor), payout.destinationCurrency)}
            </span>
          }
          description='What the provider says landed, in the destination currency'
        />
        <MetricCell
          label='Provider date'
          icon={<CalendarClock className='size-4 text-muted-foreground' />}
          value={formatEvidenceDate(payout.occurredOn ?? payout.occurredAt)}
          description='When the provider filed the payout'
        />
        <MetricCell
          label='Last imported'
          icon={<Clock className='size-4 text-muted-foreground' />}
          value={formatAuditTimestamp(payout.updatedAt, bookTimeZone)}
          description='When this evidence was last read from the source'
        />
      </MetricGrid>

      {/* Not a `Section`, so it carries its own padding - see the drawer's 🛑. */}
      <div className='flex flex-col gap-3 border-b p-3'>
        {/* 🛑 Feed-level, not per row (§10.4): one missing `paymentGatewayId`
            refuses every candidate for every item on this feed, so a banner is
            the honest count and sixteen identical row notes are not. */}
        {(payout.dominantMatchReason === 'no_rail' || !payout.paymentGatewayId) &&
          payout.needsMatchingCount > 0 && (
            <Alert variant='warning'>
              <AlertTitle>Link this feed to a payment gateway</AlertTitle>
              <AlertDescription className='flex flex-col items-start gap-2'>
                <span>
                  This source account settles no payment gateway, so no customer payment can be
                  matched to its items.
                </span>
                <Button variant='outline' size='sm' asChild>
                  <Link href={PAYMENT_GATEWAYS_HREF}>Open payment gateways</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}
        {payout.blockers.length > 0 && (
          <Alert variant='warning'>
            <AlertTitle>Evidence needs review</AlertTitle>
            <AlertDescription>
              <ul className='list-disc space-y-1 pl-4'>
                {payout.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {/* 🛑 No "Next actions" list. It restated the blockers as imperatives -
            "10 entries have no matching customer movement" paired with "import
            the related payment evidence, then refresh" - so every payout said
            the same thing twice, once as a finding and once as an instruction,
            and the instruction was generic enough to be true of every payout on
            the page. The blocker is the sentence worth keeping. `nextActions`
            is still on the DTO; nothing reads it now. */}
        {payout.bankDeposit && (
          <BankDepositLine
            bankDeposit={payout.bankDeposit}
            currency={payout.destinationCurrency}
            bookTimeZone={bookTimeZone}
          />
        )}
        <PayoutProviderSide
          payoutId={payout.payoutInstanceId}
          deposited={DEPOSITED_STATUSES.has(payout.status)}
          bookTimeZone={bookTimeZone}
          fallback={
            !payout.bankDeposit && DEPOSITED_STATUSES.has(payout.status) ? (
              <NoBankDepositLine />
            ) : null
          }
        />
      </div>

      <Section
        title='Processor activity'
        icon={<Receipt className='size-4' />}
        secondary={
          payout.needsMatchingCount > 0
            ? `${payout.entryCount} imported · ${payout.needsMatchingCount} need matching`
            : `${payout.entryCount} imported`
        }
        description='The outgoing payout is retained here and excluded from the constituent net.'
        collapsible={false}>
        <ProcessorActivity transferId={payout.id} livePostingId={payout.livePostingId} />
      </Section>

      {/* 🛑 Keyed on the `payout` RECORD's instance id, not the provider's payout
          id: that is what the posting's subject row names since §11.5, and it is
          what every other ledger card passes. No record yet means no posting. */}
      {payout.payoutInstanceId && (
        <Section title='Accounting' icon={<BookOpenCheck className='size-4' />} collapsible={false}>
          <LedgerCard entityInstanceId={payout.payoutInstanceId} sourceKind='payout' />
        </Section>
      )}
    </>
  )
}

/** Only a payout that reached the bank can be confirmed by a bank line. */
const DEPOSITED_STATUSES = new Set(['paid', 'in_transit'])

/** The bank line a reviewer matched this payout to in Banking review. */
function BankDepositLine({
  bankDeposit,
  currency,
  bookTimeZone,
}: {
  bankDeposit: {
    transactionId: string
    postedAt: string | null
    amountMinor: number
    bankAccountName: string | null
  }
  currency: string
  bookTimeZone: string
}) {
  return (
    <p className='text-muted-foreground text-xs'>
      Deposited:{' '}
      <Link
        href={`/app/accounting/banking?txn=${bankDeposit.transactionId}`}
        className='text-foreground underline-offset-2 hover:underline'>
        bank line
        {bankDeposit.postedAt && ` on ${formatAccountingDate(bankDeposit.postedAt, bookTimeZone)}`},{' '}
        {formatMinor(bankDeposit.amountMinor, currency)}
      </Link>
      {bankDeposit.bankAccountName && ` in ${bankDeposit.bankAccountName}`}
    </p>
  )
}

/** With no connected book, a bank line is the only confirmation a deposit landed. */
function NoBankDepositLine() {
  return (
    <p className='text-muted-foreground text-xs'>
      No bank deposit matched yet.{' '}
      <Link
        href='/app/accounting/banking'
        className='text-foreground underline-offset-2 hover:underline'>
        Open Banking review
      </Link>
    </p>
  )
}
