// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-detail.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { StatCards } from '@auxx/ui/components/stat-card'
import { FileCheck, Landmark, Scale } from 'lucide-react'
import Link from 'next/link'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'
import { PayoutSourceHistory } from './payout-source-history'
import { ProcessorActivity } from './processor-activity'

/** Show independent payout totals, source completeness and the actions needed to resolve gaps. */
export function PayoutEvidenceDetail({ payoutId }: { payoutId: string }) {
  const query = api.payoutEvidence.detail.useQuery({ id: payoutId })
  const payout = query.data

  if (query.error) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>Could not load payout</AlertTitle>
        <AlertDescription>
          {query.error.message} Use Refresh evidence to try again.
        </AlertDescription>
      </Alert>
    )
  }
  if (!payout) return <Skeleton className='h-64 w-full' />

  const sourceAmount = (amount: string) =>
    formatEvidenceAmount(amount, payout.sourceCurrency, payout.sourceCurrencyExponent)

  return (
    <>
      <SettingsSection
        title={payout.externalId}
        description={`${payout.providerKey} · ${payout.externalAccountId}`}
        action={
          <Button variant='outline' size='sm' asChild>
            <Link
              href={
                payout.sourceConnectionId
                  ? `/app/connectors/${payout.sourceConnectionId}`
                  : '/app/connectors'
              }>
              Open connector
            </Link>
          </Button>
        }>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='secondary'>Provider: {payout.status.replaceAll('_', ' ')}</Badge>
          <Badge variant='outline'>Evidence: {payout.membershipState}</Badge>
          <Badge variant='outline'>
            {payout.reconciliationState === 'pending'
              ? 'Provider readiness not assessed'
              : payout.providerReady
                ? 'Provider ready'
                : 'Provider pending'}
          </Badge>
          <Badge variant='outline'>Posting not enabled</Badge>
          {payout.reconciliationState === 'pending' && (
            <Badge variant='secondary'>Reconciliation pending</Badge>
          )}
        </div>
        <dl className='grid gap-3 text-sm sm:grid-cols-2'>
          <div>
            <dt className='text-muted-foreground'>Provider date</dt>
            <dd>{formatEvidenceDate(payout.occurredOn ?? payout.occurredAt)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Last imported</dt>
            <dd>{formatEvidenceDate(payout.updatedAt)}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Reported destination amount</dt>
            <dd className='font-mono tabular-nums'>
              {formatEvidenceAmount(
                payout.destinationAmountMinor,
                payout.destinationCurrency,
                payout.destinationCurrencyExponent
              )}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Bank confirmation</dt>
            <dd>Not assessed</dd>
          </div>
        </dl>
      </SettingsSection>

      <StatCards
        columns={{ default: 'grid-cols-1', md: 'md:grid-cols-3' }}
        cards={[
          {
            title: 'Reported payout',
            icon: <Landmark className='size-4' />,
            body: (
              <span className='font-mono tabular-nums'>
                {sourceAmount(payout.sourceAmountMinor)}
              </span>
            ),
            description: 'The amount independently reported by the provider',
          },
          {
            title: 'Constituent net',
            icon: <FileCheck className='size-4' />,
            body: (
              <span className='font-mono tabular-nums'>
                {payout.constituentNetMinor === null
                  ? 'Not assessed'
                  : sourceAmount(payout.constituentNetMinor)}
              </span>
            ),
            description: 'Processor activity, excluding the outgoing payout',
          },
          {
            title: 'Difference',
            icon: <Scale className='size-4' />,
            body: (
              <span className='font-mono tabular-nums'>
                {payout.differenceMinor === null
                  ? 'Not assessed'
                  : sourceAmount(payout.differenceMinor)}
              </span>
            ),
            description:
              'Reported payout less constituent net; incomplete evidence cannot establish agreement',
          },
        ]}
      />

      {(payout.blockers.length > 0 || payout.nextActions.length > 0) && (
        <SettingsSection title='What needs attention'>
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
          {payout.nextActions.length > 0 && (
            <div className='text-sm'>
              <p className='mb-2 font-medium'>Next actions</p>
              <ul className='list-disc space-y-1 pl-4'>
                {payout.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title='Processor activity'
        description={`${payout.entryCount} imported entries. The outgoing payout is retained here and excluded from the constituent net.`}>
        <ProcessorActivity transferId={payout.id} />
      </SettingsSection>

      <PayoutSourceHistory payoutId={payout.id} />

      <CollapsedJson title='Provider details' value={payout.sourceObservation} />
    </>
  )
}
