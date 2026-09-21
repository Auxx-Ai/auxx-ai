// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-drawer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Cable, Landmark } from 'lucide-react'
import Link from 'next/link'
import { SourceAccountBadge } from '~/components/accounting/ui/source-account-badge'
import { Tooltip } from '~/components/global/tooltip'
import { api } from '~/trpc/react'
import { PayoutEvidenceDetail } from './payout-evidence-detail'

interface PayoutEvidenceDrawerProps {
  payoutId: string | null
  /** Overrides `!!payoutId` so a caller still resolving the id keeps the panel mounted. */
  open?: boolean
  onOpenChange: (open: boolean) => void
  /** Docked into the Banking layout's `MainPageContent`, or a floating overlay. */
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
}

/**
 * One payout, deep-linked on `?payout=<id>` (task 49 §5).
 *
 * Docked on desktop, exactly as `review/review-drawer.tsx` is. The Banking
 * layout owns the `MainPageContent`, so the page reaches its `dockedPanels`
 * slot through `docked-panels-outlet.tsx` rather than by rendering a second
 * one.
 *
 * The IDENTITY lives here, in `DrawerHeader`, the way `posting-frame.tsx` and
 * `review-drawer.tsx` carry theirs: the external id, the source account, and
 * the status badges belong to the panel rather than to its first block, and the
 * "Open connector" link is a header action. `PayoutEvidenceDetail` is the body
 * and repeats none of it.
 *
 * ⚠️ Two readers, one request. This reads `payoutEvidence.detail` for the title
 * and the body reads it again for its own render; React Query dedupes them on
 * the shared key, so nothing is passed down and nothing is fetched twice.
 */
export function PayoutEvidenceDrawer({
  payoutId,
  open = !!payoutId,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
}: PayoutEvidenceDrawerProps) {
  const payoutQuery = api.payoutEvidence.detail.useQuery(
    { id: payoutId ?? '' },
    { enabled: !!payoutId }
  )
  // Never title the panel from a stale payout the body is refusing to show -
  // the detail renders "Could not load payout" in that state.
  const payout = payoutQuery.error ? null : (payoutQuery.data ?? null)

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={800}
      title={payout ? `Payout ${payout.externalId}` : 'Payout'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<Landmark className='size-5 text-muted-foreground' />}
          title={
            <div className='flex min-w-0 flex-col gap-1'>
              <span className='truncate font-mono font-medium'>
                {payout?.externalId ?? 'Payout'}
              </span>
              {payout && (
                <span className='flex flex-wrap items-center gap-1.5'>
                  <SourceAccountBadge
                    providerKey={payout.providerKey}
                    externalAccountId={payout.externalAccountId}
                    environment={payout.environment}
                    size='sm'
                  />
                  <Badge variant='secondary' size='xs'>
                    Provider: {payout.status.replaceAll('_', ' ')}
                  </Badge>
                  {/* 🛑 No `Evidence: <membershipState>` and no provider-readiness
                      badge. Both printed an internal vocabulary - `unsupported`,
                      `Provider ready` - that says nothing a reader can act on,
                      and the second actively misleads: a payout reads "Provider
                      ready" while the blockers list below it says ten entries
                      have no matching customer movement. The blockers Alert is
                      where that story is told, in a sentence, and it is the one
                      telling that has to stay right. */}
                  {payout.reconciliationState === 'pending' && (
                    <Badge variant='secondary' size='xs'>
                      Reconciliation pending
                    </Badge>
                  )}
                </span>
              )}
            </div>
          }
          actions={
            payout && (
              // Icon-only, the shape `base-entity-drawer.tsx` uses for its own
              // "Open full page" action: a drawer header is a narrow strip and a
              // worded button crowds the title out of it at 380px.
              <Tooltip content='Open connector'>
                <Button variant='ghost' size='icon-xs' asChild>
                  {/* ⚠️ `aria-label` as well as the tooltip. Radix associates a
                      tooltip with `aria-describedby` and only while it is open,
                      so an icon-only link has no accessible NAME without this -
                      a screen reader would announce a bare link to a URL. */}
                  <Link
                    aria-label='Open connector'
                    href={
                      payout.sourceConnectionId
                        ? `/app/connectors/${payout.sourceConnectionId}`
                        : '/app/connectors'
                    }>
                    <Cable />
                  </Link>
                </Button>
              </Tooltip>
            )
          }
          onClose={() => onOpenChange(false)}
        />
        <ScrollArea className='min-h-0 flex-1'>
          {/* 🛑 No padding and no gap on this wrapper, deliberately. `Section`
              draws its own `p-3 pb-4` AND a full-width `border-b`, so stacking
              sections FLUSH is what makes that border read as the divider
              between them, the same shape every other drawer has. A padded,
              gapped wrapper detaches each divider from the drawer edge and
              floats the blocks into cards - which is exactly what this used to
              do with `gap-8 p-4`, settings-page spacing on a 380px panel. The
              blockers Alert carries its own `p-3`; put padding on non-Section
              children like that one, never here. */}
          <div className='flex flex-col'>
            {payoutId && <PayoutEvidenceDetail key={payoutId} payoutId={payoutId} />}
          </div>
        </ScrollArea>
      </div>
    </DockableDrawer>
  )
}
