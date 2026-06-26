// apps/web/src/components/data-connectors/ui/connector-detail-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ChevronDown, FlaskConical, Pause, Play, Plug, RefreshCw, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import { useConnectorSyncRealtime } from '../hooks/use-connector-sync-realtime'
import { resolveSyncStatus } from '../lib/resolve-sync-status'
import { ConnectorDetailTabs } from './connector-detail-tabs'
import { ConnectorResyncBanner } from './connector-resync-banner'
import { ConnectorRunsPanel } from './connector-runs-panel'
import { asConnectorStatus, asRunStatus } from './connector-status'
import { ConnectorStatusLine } from './connector-status-line'
import { SampleReviewBanner } from './sample-review-banner'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

interface ConnectorDetailViewProps {
  connector: Connector
}

function iconIdForType(type: string): string {
  if (type.startsWith('app:')) return `brand:${type.slice('app:'.length)}`
  return 'plug'
}

/**
 * Connector detail view — the single page that serves both first-time setup and
 * ongoing editing, modeled on `agent-detail-view`. Page shell + status pill +
 * header actions (Sync now / Pause·Resume / Delete with keep·archive·delete), a
 * docked right Runs panel (desktop) / tab (mobile), and the Connection / Streams
 * / Schedule body. See plans/data-connectors/claude/05-frontend.md §2.
 */
export function ConnectorDetailView({ connector }: ConnectorDetailViewProps) {
  const router = useRouter()
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const [confirm, ConfirmDialog] = useConfirm()
  const [, setTab] = useQueryState('tab')

  const status = asConnectorStatus(connector.status)
  const isSyncing = status === 'syncing' || status === 'provisioning'
  const isPaused = status === 'paused'

  // Live status for the freshness line + the derived "Action needed" reconnect CTA.
  // The `dataConnector:sync` realtime feed (below) drives the snappy updates; this
  // poll is now just a SAFETY NET while a sync is in flight (realtime is best-effort
  // with no missed-event replay — a dropped frame must still converge). 15s, matching
  // the Runs panel — same query key, so the two share one request. The header
  // Sync/Pause/Resume buttons stay on the optimistic getById `status`.
  const statusQuery = api.dataConnector.getStatus.useQuery(
    { id: connector.id },
    {
      refetchInterval: (query) => {
        const s = query.state.data?.status ?? connector.status
        return s === 'syncing' || s === 'provisioning' ? 15000 : false
      },
    }
  )
  // Push live run progress + lifecycle into the shared getStatus/listRuns caches.
  useConnectorSyncRealtime(connector.id)
  const live = statusQuery.data
  const liveStatus = asConnectorStatus(live?.status ?? connector.status)
  // The run status is a free-text DB column; normalize it once for the resolver + status line.
  const latestRun = live?.latestRun
    ? { ...live.latestRun, status: asRunStatus(live.latestRun.status) }
    : null
  const resolved = resolveSyncStatus({
    status: liveStatus,
    error: live?.error ?? connector.error,
    latestRun,
  })

  const {
    syncNow,
    sampleSync,
    pause,
    resume,
    remove,
    backfillPending,
    isBackfilling,
    isSyncing: isSyncPending,
    isPausing,
    isResuming,
    isDeleting,
  } = useConnectorMutations()

  const handleDelete = async (syncedData: 'keep' | 'archive' | 'delete') => {
    const copy = {
      keep: 'Synced records are kept; only the connector is removed.',
      archive: 'Synced records are archived and the connector is removed.',
      delete: 'Synced records and the connector are permanently deleted.',
    }[syncedData]
    const ok = await confirm({
      title: 'Delete connector?',
      description: `${copy} This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok && (await remove(connector.id, syncedData))) router.push('/app/connectors')
  }

  const runsPanel = (
    <ConnectorRunsPanel
      connectorId={connector.id}
      initialStatus={status}
      sourceLabel={connector.name}
    />
  )

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              loading={isSyncPending}
              loadingText='Syncing...'
              disabled={isSyncing}
              onClick={() => syncNow(connector.id)}>
              <RefreshCw />
              Sync now
            </Button>
            {/* Sample sync (trial-sync §5.3): a bounded first look, available after setup
                too — pick a per-stream size; the run parks for review when it's done. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm' disabled={isSyncing}>
                  <FlaskConical />
                  Sample
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {[50, 100, 500].map((n) => (
                  <DropdownMenuItem key={n} onClick={() => sampleSync(connector.id, n)}>
                    Sample {n} per stream
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {resolved.state === 'action-needed' && (
              <Button variant='outline' size='sm' onClick={() => void setTab('connection')}>
                <Plug />
                Reconnect
              </Button>
            )}
            {isPaused ? (
              <Button
                variant='outline'
                size='sm'
                loading={isResuming}
                onClick={() => resume(connector.id)}>
                <Play />
                Resume
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                loading={isPausing}
                onClick={() => pause(connector.id)}>
                <Pause />
                Pause
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='destructive' size='sm' loading={isDeleting}>
                  <Trash />
                  Delete
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => void handleDelete('keep')}>
                  Delete, keep synced records
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleDelete('archive')}>
                  Delete, archive synced records
                </DropdownMenuItem>
                <DropdownMenuItem variant='destructive' onClick={() => void handleDelete('delete')}>
                  Delete connector and synced records
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
          <MainPageBreadcrumbItem
            title={connector.name}
            icon={
              <AppIcon iconId={iconIdForType(connector.type)} fallbackIconId='plug' size='xs' />
            }
            last
          />
          <ConnectorStatusLine
            status={liveStatus}
            error={live?.error ?? connector.error}
            lastSyncedAt={live?.lastSyncedAt ?? connector.lastSyncedAt}
            latestRun={latestRun}
            className='ml-2'
          />
        </MainPageBreadcrumb>
      </MainPageHeader>

      {/* Parked-sample review (trial-sync §5.2): after a sample run pauses the
          connector, offer to look at the records, then sync everything (resume). */}
      <SampleReviewBanner
        show={liveStatus === 'paused' && latestRun?.pausedReason === 'sample'}
        recordCount={live?.itemCount ?? connector.itemCount}
        onSyncEverything={() => syncNow(connector.id)}
        onEditMappings={() => void setTab('streams')}
        isSyncing={isSyncPending}
      />

      <MainPageContent
        dockedPanels={
          isDesktop
            ? [
                {
                  key: 'connector-runs',
                  content: runsPanel,
                  width: dockedWidth,
                  onWidthChange: setDockedWidth,
                  minWidth,
                  maxWidth,
                },
              ]
            : []
        }>
        <ConnectorDetailTabs
          connector={connector}
          mobileRunsPanel={!isDesktop ? runsPanel : null}
          resyncBanner={
            <ConnectorResyncBanner
              pending={live?.resyncPending}
              onBackfill={() => backfillPending(connector.id)}
              isBackfilling={isBackfilling}
            />
          }
        />
      </MainPageContent>
    </MainPage>
  )
}
