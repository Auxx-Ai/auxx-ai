// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-detail.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Banknote,
  Braces,
  CalendarClock,
  Clock,
  FileCheck,
  Landmark,
  Receipt,
  Scale,
} from 'lucide-react'
import { api } from '~/trpc/react'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'
import { PayoutSourceHistory } from './payout-source-history'
import { ProcessorActivity } from './processor-activity'

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

  const sourceAmount = (amount: string) =>
    formatEvidenceAmount(amount, payout.sourceCurrency, payout.sourceCurrencyExponent)

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
              {formatEvidenceAmount(
                payout.destinationAmountMinor,
                payout.destinationCurrency,
                payout.destinationCurrencyExponent
              )}
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
          value={formatEvidenceDate(payout.updatedAt)}
          description='When this evidence was last read from the source'
        />
      </MetricGrid>

      {/* Not a `Section`, so it carries its own padding - see the drawer's 🛑. */}
      <div className='flex flex-col gap-3 border-b p-3'>
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
            is still on the DTO; nothing reads it now.

            The line below is the two CONSTANTS the Details section used to
            spend a labelled row each on. Neither varies by payout - they are
            facts about the feature, not about this row - so they are one muted
            sentence rather than two cells reading "Not assessed". */}
        <p className='text-muted-foreground text-xs'>
          Bank confirmation is not assessed, and settlement posting is not enabled for these
          payouts.
        </p>
      </div>

      <Section
        title='Processor activity'
        icon={<Receipt className='size-4' />}
        secondary={`${payout.entryCount} imported`}
        description='The outgoing payout is retained here and excluded from the constituent net.'
        collapsible={false}>
        <ProcessorActivity transferId={payout.id} />
      </Section>

      <PayoutSourceHistory payoutId={payout.id} />

      <Section title='Provider details' icon={<Braces className='size-4' />} collapsible={false}>
        <CollapsedJson title='Source observation' value={payout.sourceObservation} />
      </Section>
    </>
  )
}
