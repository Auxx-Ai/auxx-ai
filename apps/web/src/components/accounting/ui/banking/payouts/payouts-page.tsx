// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.tsx

'use client'

// Accounting > Banking > Payouts (task 49 §3-§5; ui-plan.md §2.6).
//
// What the PROVIDER reported: `payoutEvidence.*`, exact `string` minor units,
// per-row source currency, membership and reconciliation state, and an
// explicit "Posting not enabled" badge. The sibling page, Settlements
// (`banking/settlements/settlements-page.tsx`), is what auxx POSTED from it -
// a different question, answered from a different query, on a route of its
// own.

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { AlertTriangle, Inbox, Landmark, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useMemo, useRef } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useViewportFill } from '~/hooks/use-viewport-fill'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { formatEvidenceAmount } from './evidence-format'
import { PayoutEvidenceDrawer } from './payout-evidence-drawer'
import { ProcessorActivity } from './processor-activity'
import { RejectedProcessorEvidence } from './rejected-processor-evidence'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Payouts' },
]

const PAGE_DESCRIPTION =
  'Inspect imported payouts and processor activity, exactly as the provider reported them. Settlement posting is not enabled for these payouts.'

type PayoutsTab = 'payouts' | 'unassigned' | 'issues'

const TABS = [
  { value: 'payouts', label: 'Payouts', icon: Landmark },
  { value: 'unassigned', label: 'Unassigned', icon: Inbox },
  { value: 'issues', label: 'Import issues', icon: AlertTriangle },
]

/** The frame never collapses below this, matching the review queue's own. */
const MIN_FRAME_HEIGHT = 260

/** Inspect imported payouts and processor activity as the provider reported them. */
export function PayoutsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const utils = api.useUtils()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'payouts' as string })
  const activeTab: PayoutsTab = tab === 'unassigned' || tab === 'issues' ? tab : 'payouts'

  const [payoutId, setPayoutId] = useQueryState('payout')

  /**
   * ⚠️ `1280px`, matching `review-queue-page.tsx`: this page sits behind the
   * Banking layout's `SidebarSecondary`, so the shell eats more room than a
   * bare `MainPageContent` page does, and 1280 is the first width where the
   * list keeps a readable column next to a docked panel.
   */
  const isDesktop = useMedia('(min-width: 1280px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  /**
   * ⚠️ Built ONCE and memoised. The panel array below is published to the
   * Banking layout's docked slot through an effect, so a drawer element with a
   * fresh identity every render would re-publish on every render.
   */
  const drawer = useMemo(
    () => (
      <PayoutEvidenceDrawer
        payoutId={payoutId}
        onOpenChange={(open) => {
          if (!open) void setPayoutId(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
      />
    ),
    [payoutId, setPayoutId, isDesktop, dockedWidth, setDockedWidth]
  )

  // The Banking LAYOUT owns the `MainPageContent`, so the docked panel is
  // published to it rather than passed as a prop (`docked-panels-outlet.tsx`).
  const dockedPanels = useMemo(
    () =>
      isDesktop && payoutId
        ? [
            {
              key: 'payout',
              content: drawer,
              width: dockedWidth,
              onWidthChange: setDockedWidth,
              minWidth: 380,
              maxWidth: 800,
            },
          ]
        : [],
    [isDesktop, payoutId, drawer, dockedWidth, setDockedWidth]
  )
  useRegisterDockedPanels(dockedPanels)

  /**
   * 🛑 The frame needs a DEFINITE height, and `flex-1` is not one here.
   * `SettingsPage` is itself a `ScrollArea` whose content wrapper is
   * `min-h-full` with an auto height, so a grow item of it is sized by its own
   * content, not by the container - `review-queue-page.tsx` documents this at
   * length. `useViewportFill` measures the room actually left under the
   * header instead.
   */
  const frameRef = useRef<HTMLDivElement>(null)
  const frameHeight = useViewportFill(frameRef, MIN_FRAME_HEIGHT)

  return (
    <SettingsPage
      title='Payouts'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(next) => void setTab(next)}
          items={TABS}
          size='sm'
        />
      }
      button={
        <Button variant='outline' size='sm' onClick={() => void utils.payoutEvidence.invalidate()}>
          <RefreshCw />
          Refresh evidence
        </Button>
      }>
      {/* The frame is FRAMED rather than bled to the page edges: sized to the
          room left under the header, padded away from the panel border, and
          clipped so the tab body scrolls inside the frame instead of the page
          scrolling past it - the same shape `deposits-page.tsx` uses. */}
      <div
        ref={frameRef}
        className='p-4'
        style={frameHeight ? { height: `${frameHeight}px` } : undefined}>
        <div className='flex h-full flex-col overflow-hidden rounded-xl border bg-background'>
          {activeTab === 'payouts' ? (
            <PayoutList onSelect={(id) => void setPayoutId(id)} />
          ) : activeTab === 'unassigned' ? (
            <ScrollArea className='min-h-0 flex-1'>
              <div className='flex flex-col gap-4 p-4'>
                <ProcessorActivity unassignedOnly />
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className='min-h-0 flex-1'>
              <div className='flex flex-col p-4'>
                <RejectedProcessorEvidence />
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Below the dock breakpoint the same drawer renders as a floating
          overlay, the way every other docked panel's fallback does. */}
      {!isDesktop && drawer}
    </SettingsPage>
  )
}

/** The payout list: what the provider reported, one row per payout. */
function PayoutList({ onSelect }: { onSelect: (id: string) => void }) {
  const query = api.payoutEvidence.list.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const payouts = query.data?.pages.flatMap((page) => page.items) ?? []

  if (!query.isPending && !query.error && payouts.length === 0) {
    return (
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
    )
  }

  return (
    <ScrollArea className='min-h-0 flex-1'>
      <div className='flex flex-col gap-2 p-4'>
        {query.error && (
          <Alert variant='destructive'>
            <AlertTitle>Could not load payouts</AlertTitle>
            <AlertDescription>
              {query.error.message} Use Refresh evidence to try again.
            </AlertDescription>
          </Alert>
        )}
        <TreeRowList
          items={payouts}
          loading={query.isPending}
          skeletonCount={6}
          getKey={(payout) => payout.id}
          renderRow={(payout) => (
            <TreeRow
              icon={<Landmark />}
              title={payout.externalId}
              secondary={`${payout.providerKey} · ${payout.externalAccountId}`}
              trailing={
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-mono text-sm tabular-nums'>
                    {formatEvidenceAmount(
                      payout.sourceAmountMinor,
                      payout.sourceCurrency,
                      payout.sourceCurrencyExponent
                    )}
                  </span>
                  <Badge variant='secondary' size='sm'>
                    {payout.status.replaceAll('_', ' ')}
                  </Badge>
                  <Badge
                    variant={payout.membershipState === 'complete' ? 'outline' : 'secondary'}
                    size='sm'>
                    {payout.membershipState}
                  </Badge>
                  {payout.reconciliationState === 'pending' ? (
                    <Badge variant='outline' size='sm'>
                      Reconciliation pending
                    </Badge>
                  ) : (
                    !payout.providerReady && (
                      <Badge variant='outline' size='sm'>
                        Provider pending
                      </Badge>
                    )
                  )}
                  {payout.blockers.length > 0 && (
                    <Badge variant='destructive' size='sm'>
                      Needs attention
                    </Badge>
                  )}
                </div>
              }
              onToggleOpen={() => onSelect(payout.id)}
            />
          )}
        />
        {query.hasNextPage && (
          <Button
            variant='outline'
            loading={query.isFetchingNextPage}
            loadingText='Loading...'
            onClick={() => void query.fetchNextPage()}>
            Load more payouts
          </Button>
        )}
      </div>
    </ScrollArea>
  )
}
