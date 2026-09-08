// apps/web/src/components/dashboard/ui/dashboard-detail-view.tsx
'use client'

// The dashboard detail view — the connector-detail-view analogue. Seeds the
// draft store from `dashboard.get`, renders a view/edit header, the tab strip,
// and the active tab's widget grid. View mode renders the PUBLISHED version by
// default; when a draft is parked a header Live/Draft toggle flips the canvas
// (Done lands on Draft). Edit mode renders the editable draft with drag/resize
// (plan 04), add-widget/add-tab, and the docked config panel. Edits auto-save to
// the server draft (`use-dashboard-autosave`); Publish/Discard drive versioning
// (`use-dashboard-publish`) — the agent versioning model.
//
// One render path (plan 03, MainPage slots migration): this component never
// owns `MainPage`/`MainPageHeader` — the calling route does, either
// `/app/dashboards/[dashboardId]/page.tsx` (standalone) or an entity route's
// `EntityRouteLayout` (via `EntityDashboardPage`). It renders `MainPageContent`
// (with `dockedPanels`) and contributes the action cluster (Edit/Add widget/
// Done + publish) via `MainPageAction` and the breadcrumb tail (dashboard
// switcher + private-lock indicator) via `MainPageCrumbs` — both portal into
// whichever ancestor shell mounted them, so behavior is identical either way.
//
// All store wiring (draft-store seed, autosave, publish) is identical on every
// route — the store is keyed by dashboard id, so a tickets-route mount and a
// dashboards-route mount of the SAME dashboard behave identically.
//
// Deferred (plan 08): global filter bar, drill-down, chart refresh.

import type { DashboardWithLayout, WidgetKind } from '@auxx/lib/dashboards/client'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { BreadcrumbItem } from '@auxx/ui/components/breadcrumb'
import { Button } from '@auxx/ui/components/button'
import { MainPageAction, MainPageContent, MainPageCrumbs } from '@auxx/ui/components/main-page'
import { Lock, Share2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { useFavoriteToggle } from '~/components/favorites/hooks/use-favorite-toggle'
import { FavoriteStarButton } from '~/components/favorites/ui/favorite-star-button'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { RecordDrawer } from '~/components/records/record-drawer'
import { useConfirm } from '~/hooks/use-confirm'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useAccess } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { useDashboardAutosave } from '../hooks/use-dashboard-autosave'
import { useDashboardDraftRealtime } from '../hooks/use-dashboard-draft-realtime'
import { useDashboardDraftSync } from '../hooks/use-dashboard-draft-sync'
import { useDashboardKopilotTurn, useDashboardTurnLock } from '../hooks/use-dashboard-kopilot-turn'
import { useDashboardPublish } from '../hooks/use-dashboard-publish'
import {
  selectCurrentTabs,
  selectHasUnpublishedChanges,
  selectViewLayer,
  useDashboardStore,
} from '../stores/dashboard-draft-store'
import { AddWidgetMenu } from './config/add-widget-menu'
import { WidgetConfigPanel } from './config/widget-config-panel'
import { DashboardGrid } from './dashboard-grid'
import { DashboardKopilotTurnPill } from './dashboard-kopilot-turn-pill'
import { DashboardKopilotTurnReview } from './dashboard-kopilot-turn-review'
import { DashboardPublishCluster } from './dashboard-publish-cluster'
import { DashboardSwitcherList } from './dashboard-switcher-list'
import { DashboardTabStrip } from './dashboard-tab-strip'
import { DashboardWidget } from './widget/dashboard-widget'

/**
 * `DASHBOARD_BUILDER_PAGE` from `@auxx/lib/ai/kopilot` — hardcoded here for the
 * same reason every other builder page hardcodes its key (KB's 'kb', the agent
 * builder's 'agents.builder', the workflow builder's 'workflow.builder'): the
 * constant only lives on a server-side barrel. The stream route gates the
 * dashboard-builder tools on this exact value.
 */
const DASHBOARD_BUILDER_PAGE = 'dashboard.builder'

/**
 * Shown on every write in the header cluster while a Kopilot turn holds the
 * draft. The canvas clamp below rides `isEditMode`, but Edit, Publish, Discard
 * and the version-history writes all live in VIEW mode and are not downstream
 * of it, so they need the lock passed to them explicitly.
 */
const KOPILOT_TURN_LOCK_REASON =
  'Kopilot is working on this dashboard. This is available again when it finishes.'

export function DashboardDetailView({
  dashboard,
  startInEditMode = false,
}: {
  dashboard: DashboardWithLayout
  /**
   * Entity-dashboard-only: drop straight into edit mode once this dashboard's
   * draft has been seeded — the entity dashboard empty-state's "Create" CTA
   * publishes an empty v1 then wants the user editing it immediately, not
   * viewing it. Gated on the seed (not just mount) so it can't race `seed()`'s
   * own `isEditMode` reset for a freshly-seeded dashboard id.
   */
  startInEditMode?: boolean
}) {
  const router = useRouter()

  // Per-instance tiers for THIS dashboard, derived once (doc 24 §A.2.4's shape,
  // by props rather than a context — the tree is three components deep):
  //   canEdit  → widgets/tabs/layout, publish, discard, version restore/delete/
  //              rename. Everything downstream of it hangs off `isEditMode`, so
  //              gating the mode is what gates the whole canvas.
  //   canAdmin → dashboard settings (`dashboard.update`) + archive.
  //   canCreate → the coarse `dashboards.manage` rung behind Duplicate.
  // Resolved BEFORE the server-facing hooks below, because the realtime
  // subscriber takes `canEdit`.
  const { can, canEditInstance, canAdminInstance } = useAccess()
  const dashboardRecordId = toRecordId('dashboard', dashboard.id)
  const canEdit = canEditInstance(dashboardRecordId)
  const canAdmin = canAdminInstance(dashboardRecordId)
  const canCreate = can('dashboards.manage')

  const draftQuery = useDashboardDraftSync(dashboard.id, canEdit)
  // The three server-facing hooks for the open dashboard, mounted once and in
  // this order: the turn lock is what the auto-save suspends on, and the
  // realtime refresh is what feeds the auto-save its next CAS token (its
  // refetch writes the same query cache `useDashboardDraftSync` reads).
  useDashboardKopilotTurn(dashboard.id)
  useDashboardDraftRealtime(dashboard.id, canEdit)
  useDashboardAutosave({
    dashboardId: dashboard.id,
    seedLayoutHash: draftQuery.data?.draftLayoutHash,
  })
  const kopilotTurn = useDashboardTurnLock(dashboard.id)

  const enteredInitialEditRef = useRef(false)
  const enterEditModeAction = useDashboardStore((s) => s.enterEditMode)
  useEffect(() => {
    if (!canEdit || !startInEditMode || enteredInitialEditRef.current || !draftQuery.data) return
    enteredInitialEditRef.current = true
    enterEditModeAction()
  }, [canEdit, startInEditMode, draftQuery.data, enterEditModeAction])

  const [confirm, ConfirmDialog] = useConfirm()
  // `dtab`, NOT `tab`. `?tab=` has three owners in this app, and one of them is
  // a GUEST on this page: `useRecordPeekStack` (records/record-drill-panels.tsx)
  // declares `tab` among its own params and deliberately CLEARS it on every
  // push/pop/clear, so that opening a record from a recordList widget wipes the
  // drawer's stale inner tab. It also wiped ours, and the dashboard silently
  // fell back to `tabs[0]` (Overview). Namespacing the host's param is the
  // narrow fix: the drawer legitimately owns `tab` in its own context, and it
  // can be hosted on any page, so the page is what should get out of its way.
  const [tabParam, setTab] = useQueryState('dtab')
  const [selectedWidgetId, setSelectedWidgetId] = useQueryState('widget')
  const [shareOpen, setShareOpen] = useState(false)

  // Record opened from a recordList widget (view mode). Lifted to the page so
  // the drawer renders in the docked panel / overlay, not clipped inside the
  // widget card — mirrors records-view.
  const [openRecordId, setOpenRecordId] = useState<RecordId | null>(null)

  const tabs = useDashboardStore(selectCurrentTabs)
  const storeIsEditMode = useDashboardStore((s) => s.isEditMode)
  // One gate for the whole editable canvas: the tab strip's add/rename/reorder/
  // delete, the grid's drag/resize, every widget card action, the config panel,
  // and richText's inline editor all key off `isEditMode`. Clamping it here means
  // a Read member can never render a widget/layout affordance even if the store
  // carries a stale edit flag.
  //
  // A held Kopilot turn clamps it the same way, at the same single point, so the
  // canvas goes read-only for the span of the turn without N new checks. The
  // store's own `isEditMode` is untouched, so the canvas comes straight back
  // when the lock releases.
  const isEditMode = storeIsEditMode && canEdit && !kopilotTurn
  const hasUnpublishedChanges = useDashboardStore(selectHasUnpublishedChanges)
  // Rides the Kopilot `dashboard` chip so a layout mutation refuses against a
  // draft this page has not flushed yet. Selector, never a destructure.
  const isDirty = useDashboardStore((s) => s.isDirty)
  const viewLayer = useDashboardStore(selectViewLayer)
  const setViewLayer = useDashboardStore((s) => s.setViewLayer)
  const saveState = useDashboardStore((s) => s.saveState)
  const hasPersisted = useDashboardStore((s) => s.persisted !== null)
  const enterEditMode = useDashboardStore((s) => s.enterEditMode)
  const exitEditMode = useDashboardStore((s) => s.exitEditMode)
  const addWidget = useDashboardStore((s) => s.addWidget)
  const addTab = useDashboardStore((s) => s.addTab)
  const updateTab = useDashboardStore((s) => s.updateTab)
  const removeTab = useDashboardStore((s) => s.removeTab)
  const reorderTabs = useDashboardStore((s) => s.reorderTabs)
  const applyGridLayout = useDashboardStore((s) => s.applyGridLayout)
  const setDraggingWidgetId = useDashboardStore((s) => s.setDraggingWidgetId)
  const updateWidgetConfig = useDashboardStore((s) => s.updateWidgetConfig)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const duplicateWidget = useDashboardStore((s) => s.duplicateWidget)
  const persistedVersionNumber = useDashboardStore((s) => s.persistedVersionNumber)

  const { publish, discard, isPublishing, isDiscarding } = useDashboardPublish()

  const { toggle: toggleFavorite, isFavorited } = useFavoriteToggle('DASHBOARD', {
    dashboardId: dashboard.id,
  })

  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((s) => s.dockedWidth)
  const setDockedWidth = useDockStore((s) => s.setDockedWidth)
  const dockMinWidth = useDockStore((s) => s.minWidth)
  const dockMaxWidth = useDockStore((s) => s.maxWidth)

  const activeTabId = tabs.find((t) => t.id === tabParam)?.id ?? tabs[0]?.id ?? ''
  const activeTab = tabs.find((t) => t.id === activeTabId)

  // The config panel opens on a draft widget while editing (plan 07).
  const configWidgetId =
    isEditMode &&
    selectedWidgetId &&
    tabs.some((t) => t.widgets.some((w) => w.id === selectedWidgetId))
      ? selectedWidgetId
      : null
  const closeConfig = () => void setSelectedWidgetId(null)

  const handleAddWidget = (kind: WidgetKind, at?: { x: number; y: number }) => {
    if (!activeTabId) return
    const id = addWidget(activeTabId, kind, at)
    if (id) void setSelectedWidgetId(id)
  }

  // Docked: the panel stays open for the whole edit session so the grid width
  // doesn't shift when a widget is (de)selected — it shows an empty "select or
  // add a widget" state when nothing is focused. Overlay/mobile: only on select.
  const isConfigOpen = isDocked ? isEditMode : !!configWidgetId

  // The DockableDrawer renders as a docked panel (into MainPageContent's dock
  // slot) or a right-side overlay, mirroring the record drawer. One element,
  // placed in whichever host matches the current dock mode.
  const configPanel = (
    <WidgetConfigPanel
      widgetId={configWidgetId}
      open={isConfigOpen}
      onOpenChange={(o) => !o && closeConfig()}
      onClose={closeConfig}
      onSelectWidget={(id) => void setSelectedWidgetId(id)}
      onAddWidget={handleAddWidget}
      isDocked={isDocked}
      dockedWidth={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={dockMinWidth}
      maxWidth={dockMaxWidth}
    />
  )

  // Record drawer opened from a recordList widget (view mode only). Same
  // element in both dock modes — RecordDrawer picks docked vs overlay itself.
  const recordDrawer = (
    <RecordDrawer
      open={!isEditMode && !!openRecordId}
      onOpenChange={(o) => !o && setOpenRecordId(null)}
      recordId={openRecordId ?? undefined}
    />
  )

  // Docked slot hosts the config panel while editing, or the record drawer in
  // view mode — they never overlap (records aren't clickable in edit mode).
  // Overlay mode: config panel opens on select; record drawer uses the same
  // condition in both modes (RecordDrawer picks docked vs overlay itself).
  const { dockedPanels, overlays } = useDockedPanels([
    {
      key: 'widget-config',
      open: { docked: isEditMode, overlay: !!configWidgetId },
      content: configPanel,
    },
    {
      key: 'record-detail',
      open: !isEditMode && !!openRecordId,
      content: recordDrawer,
    },
  ])

  const commandContext = (
    // Command-palette scope for the open dashboard. Edit-only actions mirror
    // the header cluster's affordances.
    <CommandContext kind='page' label={dashboard.name}>
      {canEdit && (
        <CommandAction
          label={isEditMode ? 'Done editing' : 'Edit dashboard'}
          icon={isEditMode ? 'check' : 'edit'}
          keywords='edit done toggle layout arrange'
          priority={10}
          perform={() => {
            useCommandPaletteStore.getState().close()
            if (isEditMode) {
              exitEditMode()
            } else {
              setOpenRecordId(null)
              enterEditMode()
            }
          }}
        />
      )}
      <CommandAction
        label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        icon='star'
        keywords='favorite star bookmark pin'
        priority={9}
        perform={() => {
          useCommandPaletteStore.getState().close()
          toggleFavorite()
        }}
      />
      {isEditMode && (
        <>
          <CommandAction
            label='Add widget'
            icon='plus'
            keywords='add widget chart kpi card'
            priority={8}
            perform={() => {
              useCommandPaletteStore.getState().close()
              handleAddWidget('kpi')
            }}
          />
          <CommandAction
            label='Add tab'
            icon='plus'
            keywords='add tab page section'
            priority={7}
            perform={() => {
              useCommandPaletteStore.getState().close()
              const id = addTab('New tab')
              if (id) void setTab(id)
            }}
          />
        </>
      )}
      {canEdit && hasUnpublishedChanges && (
        <>
          <CommandAction
            label='Publish changes'
            icon='send'
            keywords='publish release live version'
            priority={6}
            disabled={isPublishing}
            perform={() => {
              useCommandPaletteStore.getState().close()
              void publish()
            }}
          />
          <CommandAction
            label='Discard changes'
            icon='trash'
            keywords='discard revert reset draft'
            priority={5}
            disabled={isDiscarding}
            perform={() => {
              useCommandPaletteStore.getState().close()
              void discard()
            }}
          />
        </>
      )}
    </CommandContext>
  )

  // Edit/Add-widget/Done + publish cluster — contributed into the calling
  // route's header action cluster via `MainPageAction`.
  const actionCluster = (
    <div className='flex flex-row items-center gap-2'>
      <DashboardKopilotTurnPill dashboardId={dashboard.id} />
      <FavoriteStarButton
        targetType='DASHBOARD'
        targetIds={{ dashboardId: dashboard.id }}
        size='icon-xs'
      />
      {canAdmin && (
        <>
          <Button variant='outline' size='sm' onClick={() => setShareOpen(true)}>
            <Share2 />
            Share
          </Button>
          <InstanceShareDialog
            recordId={dashboardRecordId}
            open={shareOpen}
            onOpenChange={setShareOpen}
          />
        </>
      )}
      <DashboardPublishCluster
        dashboard={dashboard}
        activeVersionNumber={persistedVersionNumber ?? dashboard.versionNumber}
        isEditMode={isEditMode}
        hasUnpublishedChanges={hasUnpublishedChanges}
        isPublishing={isPublishing}
        isDiscarding={isDiscarding}
        saveState={saveState}
        hasPersisted={hasPersisted}
        canEdit={canEdit}
        canAdmin={canAdmin}
        canCreate={canCreate}
        lockedReason={kopilotTurn ? KOPILOT_TURN_LOCK_REASON : undefined}
        viewLayer={viewLayer}
        onViewLayerChange={setViewLayer}
        onEnterEdit={() => {
          setOpenRecordId(null)
          enterEditMode()
        }}
        onExitEdit={exitEditMode}
        onPublish={() => void publish()}
        onDiscard={() => void discard()}
        onAddWidget={handleAddWidget}
      />
    </div>
  )

  const tabStripAndGrid = (
    <div
      className={
        isEditMode
          ? 'flex min-h-0 flex-1 flex-col rounded-lg bg-muted/20'
          : 'flex min-h-0 flex-1 flex-col'
      }>
      <DashboardKopilotTurnReview dashboardId={dashboard.id} canEdit={canEdit} />
      <DashboardTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        isEditMode={isEditMode}
        onSelect={(id) => void setTab(id)}
        onAdd={(title) => {
          const id = addTab(title)
          if (id) void setTab(id)
        }}
        onRename={(id, title) => updateTab(id, { title })}
        onReorder={reorderTabs}
        onRemove={removeTab}
      />

      <div className='min-h-0 flex-1 overflow-y-auto p-3'>
        {activeTab && activeTab.widgets.length === 0 ? (
          <EmptyTab isEditMode={isEditMode} onAdd={handleAddWidget} />
        ) : (
          activeTab && (
            <DashboardGrid
              key={activeTab.id}
              widgets={activeTab.widgets}
              isEditMode={isEditMode}
              onLayoutCommit={(changes) => applyGridLayout(activeTab.id, changes)}
              onDragStateChange={setDraggingWidgetId}
              onAddWidgetAt={(kind, position) => handleAddWidget(kind, position)}
              renderWidget={(widget) => (
                <DashboardWidget
                  widget={widget}
                  isEditMode={isEditMode}
                  isSelected={selectedWidgetId === widget.id}
                  onSelect={() => void setSelectedWidgetId(widget.id)}
                  onEdit={() => void setSelectedWidgetId(widget.id)}
                  onDuplicate={() => duplicateWidget(widget.id)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: 'Delete widget?',
                      description: `"${widget.title}" will be removed.`,
                      confirmText: 'Delete',
                      cancelText: 'Cancel',
                      destructive: true,
                    })
                    if (ok) removeWidget(widget.id)
                  }}
                  onConfigChange={(config) => updateWidgetConfig(widget.id, config)}
                  onOpenRecord={setOpenRecordId}
                />
              )}
            />
          )
        )}
      </div>
    </div>
  )

  return (
    <>
      {commandContext}
      {/*
        UNGATED on `canEdit`, deliberately. A read-only member should still get a
        Kopilot that knows which dashboard is open and can answer questions about
        it; the stream route's guard tiering is what withholds the write tools,
        and asserting that twice in two places is how the two answers drift.

        This page does NOT hide the global dock (unlike the workflow builder,
        which calls `useEmbeddedKopilotSurface()`), so the existing dock serves
        it and no chat panel component is needed here.
      */}
      <KopilotContext
        page={DASHBOARD_BUILDER_PAGE}
        activeDashboardId={dashboard.id}
        activeDashboardLabel={dashboard.name}
        activeDashboardIsDirty={isDirty}
      />
      <ConfirmDialog />

      <MainPageAction>{actionCluster}</MainPageAction>
      <MainPageCrumbs>
        <DashboardSwitcherList
          activeDashboardId={dashboard.id}
          activeDashboardName={dashboard.name}
          onSelectDashboard={(id) => router.push(`/app/dashboards/${id}`)}
          onActiveDashboardDeleted={() => router.push('/app/dashboards')}
        />
        {dashboard.isPrivate && (
          <BreadcrumbItem>
            <Lock className='size-3.5 text-muted-foreground' aria-label='Private dashboard' />
          </BreadcrumbItem>
        )}
      </MainPageCrumbs>

      <MainPageContent dockedPanels={dockedPanels}>{tabStripAndGrid}</MainPageContent>

      {overlays}
    </>
  )
}

function EmptyTab({
  isEditMode,
  onAdd,
}: {
  isEditMode: boolean
  onAdd: (kind: WidgetKind) => void
}) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground'>
      <p className='text-sm'>This tab is empty.</p>
      {isEditMode && <AddWidgetMenu onAdd={onAdd} />}
    </div>
  )
}
