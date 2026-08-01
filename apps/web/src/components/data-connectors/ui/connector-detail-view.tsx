// apps/web/src/components/data-connectors/ui/connector-detail-view.tsx
'use client'

import {
  getConnectorReadiness,
  READINESS_REASON,
  type ReadinessStream,
} from '@auxx/lib/data-connectors/client'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
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
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Plug, RefreshCw, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { api, type RouterOutputs } from '~/trpc/react'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import { useConnectorSyncRealtime } from '../hooks/use-connector-sync-realtime'
import { resolveSyncStatus } from '../lib/resolve-sync-status'
import {
  selectIsDirty,
  useConnectorDraftStore,
  visibleMappings,
} from '../stores/connector-draft-store'
import { ConnectorBreadcrumbSwitcher } from './connector-breadcrumb-switcher'
import { ConnectorDetailTabs } from './connector-detail-tabs'
import { ConnectorResyncBanner } from './connector-resync-banner'
import { ConnectorRunsPanel } from './connector-runs-panel'
import { asConnectorStatus, asRunStatus } from './connector-status'
import { ConnectorStatusLine } from './connector-status-line'
import { SampleReviewBanner } from './sample-review-banner'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

interface ConnectorDetailViewProps {
  connector: Connector
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

  const [confirm, ConfirmDialog] = useConfirm()
  const [, setTab] = useQueryState('tab')

  // Owned entity defs this connector provisioned — already on the cached resource
  // shape (`CustomResource.dataConnectorId`), so no extra query. Used to spell out
  // the blast radius in the `delete` confirm copy. Contributing columns on shared
  // defs aren't counted (they survive a `delete` as user-owned).
  const { customResources } = useResources()
  const ownedDefs = useMemo(
    () => customResources.filter((r) => r.dataConnectorId === connector.id),
    [customResources, connector.id]
  )
  // Owned defs ANOTHER connector still maps to — a `delete` keeps these (reassigns
  // ownership) rather than tears them down. Split them out of the delete-blast-radius
  // copy so "delete definitions" doesn't imply a shared record type gets wiped.
  const sharedOwnedDefs = api.dataConnector.sharedOwnedDefs.useQuery({ id: connector.id })
  const sharedDefIds = useMemo(() => new Set(sharedOwnedDefs.data ?? []), [sharedOwnedDefs.data])

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

  // Pause/resume cluster pill: a colored dot + short label.
  // green=live/ready · amber=syncing/provisioning · red=paused or action-needed.
  // Drive paused/syncing off the OPTIMISTIC getById `status` (same source the toggle
  // uses) so a click flips the dot instantly — the `getStatus` poll lags and only
  // refetches mid-sync. `action-needed` is the one state that comes from the resolver.
  const actionNeeded = resolved.state === 'action-needed'
  const pillDotClass =
    isPaused || actionNeeded ? 'bg-red-500' : isSyncing ? 'bg-amber-500' : 'bg-emerald-500'
  const pillLabel = isPaused
    ? 'Paused'
    : actionNeeded
      ? 'Action needed'
      : isSyncing
        ? 'Syncing'
        : 'Live'

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

  // Readiness + dirty gate for the sync actions (plan §7a). Computed off the DRAFT so it
  // previews what the config WILL be once saved (never stale), and combined with the
  // dirty gate so "Sync now" can't act on a half-edited config. We only soft-disable once
  // the draft is SEEDED for this connector (the editor mounted it) — before that we defer
  // to the authoritative server guard (Phase 0) rather than flash a false-disabled button.
  const draftSeeded = useConnectorDraftStore((s) => s.connectorId === connector.id)
  const draftMeta = useConnectorDraftStore((s) => s.meta)
  const draftStreams = useConnectorDraftStore((s) => s.draft.streams)
  const draftConfig = useConnectorDraftStore((s) => s.draft.config)
  const isDirty = useConnectorDraftStore(selectIsDirty)
  const readiness = useMemo(() => {
    if (!draftSeeded || !draftMeta) return null
    const streams: ReadinessStream[] = draftStreams.map((s) => ({
      enabled: s.enabled,
      sourceSchema: s.sourceSchema,
      requestConfig: s.requestConfig ?? null,
      mappings: visibleMappings(s).map((m) => ({
        entityDefinitionId: m.entityDefinitionId,
        fieldMappings: m.fieldMappings,
      })),
    }))
    return getConnectorReadiness(
      {
        definitionKind: draftMeta.definitionKind,
        config: draftConfig as never,
        credentialId: draftMeta.credentialId,
      },
      streams
    )
  }, [draftSeeded, draftMeta, draftStreams, draftConfig])

  // Sync / Sample need a COMPLETE config (readiness) AND a SAVED one (not dirty) — §7a.
  // Reason text, or null when the action is allowed.
  const syncBlockReason =
    readiness && !readiness.canSync
      ? READINESS_REASON[readiness.problems[0] ?? 'no-endpoint']
      : isDirty
        ? 'Save changes first'
        : null

  const handleDelete = async (syncedData: 'keep' | 'archive' | 'delete') => {
    // Owned defs split into those THIS delete tears down (sole owner) vs those it keeps
    // (another connector still maps to them — reassigned, not deleted).
    const toDelete = ownedDefs.filter((d) => !sharedDefIds.has(d.id))
    const keptShared = ownedDefs.filter((d) => sharedDefIds.has(d.id))
    const deleteClause = toDelete.length
      ? `, including ${toDelete.length} entity ${
          toDelete.length === 1 ? 'definition' : 'definitions'
        } (${toDelete.map((d) => d.label).join(', ')}) and all their records`
      : ''
    const sharedClause = keptShared.length
      ? ` ${keptShared.length} record ${keptShared.length === 1 ? 'type' : 'types'} (${keptShared
          .map((d) => d.label)
          .join(', ')}) ${
          keptShared.length === 1 ? 'is' : 'are'
        } shared with another connector and will be kept.`
      : ''
    const copy = {
      keep: 'Synced records are kept; only the connector is removed.',
      archive: 'Synced records are archived and the connector is removed.',
      delete: `Synced records and the connector are permanently deleted${deleteClause}.${sharedClause}`,
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

  // Runs panel — docked-only, no overlay: below the desktop breakpoint (or
  // undocked) `ConnectorDetailTabs` renders it inline via `mobileRunsPanel`.
  const { dockedPanels, isDocked } = useDockedPanels([
    {
      key: 'connector-runs',
      open: { docked: true, overlay: false },
      content: runsPanel,
    },
  ])

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {/* Reconnect stays a standalone CTA to the left of the cluster, shown only
                when the connection needs attention (the resolver's action-needed state). */}
            {actionNeeded && (
              <Button variant='outline' size='xs' onClick={() => void setTab('connection')}>
                <Plug />
                Reconnect
              </Button>
            )}
            <ButtonGroup className='shrink-0'>
              {/* Pause/resume toggle: the colored dot conveys live status, clicking it
                  flips paused ⇄ live. Decision uses the authoritative `isPaused`; the
                  dot/label follow the live polled status. */}
              <Tooltip content={isPaused ? 'Click to resume' : 'Click to pause'}>
                <Button
                  variant='outline'
                  size='xs'
                  className='gap-2 border-r-0'
                  loading={isPausing || isResuming}
                  loadingText=''
                  onClick={() => (isPaused ? resume(connector.id) : pause(connector.id))}>
                  <span className={cn('inline-block size-2 rounded-full', pillDotClass)} />
                  {pillLabel}
                </Button>
              </Tooltip>

              <ButtonGroupSeparator />

              {/* Sync now is the split button's primary action; soft-disable (not native
                  `disabled`) when the config is incomplete OR unsaved so a tooltip can
                  explain why; native `disabled` stays for the in-flight state. */}
              {(() => {
                const syncButton = (
                  <Button
                    variant='outline'
                    size='xs'
                    className={cn('border-r-0', syncBlockReason && 'cursor-not-allowed opacity-50')}
                    loading={isSyncPending}
                    loadingText='Syncing...'
                    disabled={isSyncing}
                    aria-disabled={!!syncBlockReason}
                    onClick={() => {
                      if (syncBlockReason) return
                      syncNow(connector.id)
                    }}>
                    <RefreshCw />
                    Sync now
                  </Button>
                )
                return syncBlockReason ? (
                  <Tooltip content={syncBlockReason}>{syncButton}</Tooltip>
                ) : (
                  syncButton
                )
              })()}

              <ButtonGroupSeparator />

              {/* Sample sync (trial-sync §5.3): the attached chevron opens per-stream
                  sizes; same readiness gate as Sync now. The run parks for review. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    size='xs'
                    className={cn(
                      'border-r-0 px-1.5',
                      syncBlockReason && 'cursor-not-allowed opacity-50'
                    )}
                    disabled={isSyncing}
                    aria-disabled={!!syncBlockReason}
                    aria-label='Sample sync'
                    onClick={(e) => {
                      if (syncBlockReason) e.preventDefault()
                    }}>
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

              <ButtonGroupSeparator />

              {/* Delete overflow menu — keep / archive / delete synced records. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    size='xs'
                    className='px-1.5'
                    loading={isDeleting}
                    loadingText=''
                    aria-label='Delete connector'>
                    <Trash />
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {(live?.itemCount ?? connector.itemCount) > 0 ? (
                    <>
                      <DropdownMenuItem onClick={() => void handleDelete('keep')}>
                        Delete, keep synced records
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleDelete('archive')}>
                        Delete, archive synced records
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => void handleDelete('delete')}>
                        Delete connector and synced records
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={() => void handleDelete('delete')}>
                      Delete connector
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
          <ConnectorBreadcrumbSwitcher
            activeConnectorId={connector.id}
            activeLabel={connector.name}
            activeType={connector.type}
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

      <MainPageContent dockedPanels={dockedPanels}>
        <ConnectorDetailTabs
          connector={connector}
          mobileRunsPanel={!isDocked ? runsPanel : null}
          sampleReviewBanner={
            // Parked-sample review (trial-sync §5.2): after a sample run pauses the
            // connector, offer to look at the records, then sync everything (resume).
            <SampleReviewBanner
              show={liveStatus === 'paused' && latestRun?.pausedReason === 'sample'}
              recordCount={live?.itemCount ?? connector.itemCount}
              onSyncEverything={() => syncNow(connector.id)}
              onEditMappings={() => void setTab('streams')}
              isSyncing={isSyncPending}
            />
          }
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
