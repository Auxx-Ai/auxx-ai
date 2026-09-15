// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { ArrowLeft, Landmark, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'
import { PayoutEvidenceDetail } from './payout-evidence-detail'
import { ProcessorActivity } from './processor-activity'
import { RejectedProcessorEvidence } from './rejected-processor-evidence'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Payouts', href: '/app/accounting/banking/payouts' },
]

/** Read persisted payouts and pending processor activity without posting settlements. */
export function PayoutEvidencePage({ onHistory }: { onHistory: () => void }) {
  useRequireCapability(PermissionKey.ledgerView)
  const [payoutId, setPayoutId] = useQueryState('payout')
  const [activity, setActivity] = useQueryState('activity')
  const utils = api.useUtils()

  return (
    <SettingsPage
      title={payoutId ? 'Payout details' : 'Payouts'}
      description='Inspect imported payouts and processor activity. Settlement posting is not enabled for these payouts.'
      breadcrumbs={BREADCRUMBS}
      button={
        <div className='flex flex-wrap gap-2'>
          {payoutId ? (
            <Button variant='outline' size='sm' onClick={() => void setPayoutId(null)}>
              <ArrowLeft />
              All payouts
            </Button>
          ) : (
            <Button variant='outline' size='sm' onClick={onHistory}>
              Settlement history
            </Button>
          )}
          <Button
            variant='outline'
            size='sm'
            onClick={() => void utils.payoutEvidence.invalidate()}>
            <RefreshCw />
            Refresh evidence
          </Button>
        </div>
      }>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        {payoutId ? (
          <PayoutEvidenceDetail key={payoutId} payoutId={payoutId} />
        ) : (
          <>
            <div className='flex flex-wrap gap-2' aria-label='Payout views'>
              <Button
                variant={activity ? 'outline' : 'default'}
                size='sm'
                onClick={() => void setActivity(null)}>
                Payouts
              </Button>
              <Button
                variant={activity === 'unassigned' ? 'default' : 'outline'}
                size='sm'
                onClick={() => void setActivity('unassigned')}>
                Unassigned activity
              </Button>
              <Button
                variant={activity === 'rejected' ? 'default' : 'outline'}
                size='sm'
                onClick={() => void setActivity('rejected')}>
                Import issues
              </Button>
            </div>
            {activity === 'rejected' ? (
              <RejectedProcessorEvidence />
            ) : activity === 'unassigned' ? (
              <SettingsSection
                title='Unassigned processor activity'
                description='Activity the processor has not yet assigned to a payout. A payment can arrive before its payout.'>
                <ProcessorActivity unassignedOnly />
              </SettingsSection>
            ) : (
              <PayoutEvidenceList onSelect={(id) => void setPayoutId(id)} />
            )}
          </>
        )}
      </div>
    </SettingsPage>
  )
}

function PayoutEvidenceList({ onSelect }: { onSelect: (id: string) => void }) {
  const query = api.payoutEvidence.list.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const payouts = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <SettingsSection
      title='Imported payouts'
      description='Provider status and evidence completeness are shown separately. A paid payout does not confirm a bank deposit.'>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load payouts</AlertTitle>
          <AlertDescription>
            {query.error.message} Use Refresh evidence to try again.
          </AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : !query.error && payouts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title='No payout evidence yet'
          description='Import payout and processor activity evidence to inspect it here.'
          button={
            <Button variant='outline' asChild>
              <Link href='/app/connectors'>Open connectors</Link>
            </Button>
          }
        />
      ) : payouts.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payout / account</TableHead>
              <TableHead>Provider date</TableHead>
              <TableHead className='text-right'>Reported amount</TableHead>
              <TableHead>Provider status</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <TableRow key={payout.id}>
                <TableCell>
                  <button
                    type='button'
                    className='text-left font-medium underline-offset-4 hover:underline'
                    onClick={() => onSelect(payout.id)}>
                    {payout.externalId}
                  </button>
                  <div className='text-xs text-muted-foreground'>
                    {payout.providerKey} · {payout.externalAccountId}
                  </div>
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatEvidenceDate(payout.occurredOn ?? payout.occurredAt)}
                </TableCell>
                <TableCell className='whitespace-nowrap text-right font-mono tabular-nums'>
                  {formatEvidenceAmount(
                    payout.sourceAmountMinor,
                    payout.sourceCurrency,
                    payout.sourceCurrencyExponent
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant='secondary'>{payout.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>
                  <div className='flex flex-wrap gap-1'>
                    <Badge
                      variant={payout.membershipState === 'complete' ? 'outline' : 'secondary'}>
                      {payout.membershipState}
                    </Badge>
                    {payout.reconciliationState === 'pending' ? (
                      <Badge variant='outline'>Reconciliation pending</Badge>
                    ) : (
                      !payout.providerReady && <Badge variant='outline'>Provider pending</Badge>
                    )}
                    {payout.blockers.length > 0 && (
                      <Badge variant='destructive'>Needs attention</Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more payouts
        </Button>
      )}
    </SettingsSection>
  )
}
