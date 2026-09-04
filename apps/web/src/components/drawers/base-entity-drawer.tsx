// apps/web/src/components/drawers/base-entity-drawer.tsx
'use client'

import type { ResolvedLayoutTab, TabVisibilityContext } from '@auxx/lib/record-layout/client'
import { permittedLayoutTabs, visibleTabBlocks } from '@auxx/lib/record-layout/client'
import type {
  DrawerTabCardDefinition,
  DrawerTabDefinition,
  LayoutBlock,
  Resource,
} from '@auxx/lib/resources/client'
import { DETAILS_BLOCK_ID, getEntityDrawerConfig, parseRecordId } from '@auxx/lib/resources/client'
import { COMMUNICATION_TIMELINE_EVENT_TYPES } from '@auxx/lib/timeline/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import Loader from '@auxx/ui/components/loader'
import { NavStack, NavStackBar, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { OverflowTabsList, type TabDefinition, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import { Circle, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { AppRecordActions } from '~/components/detail-view/components/app-record-actions'
import { getIconComponent } from '~/components/detail-view/utils'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { useCommentAccess } from '~/components/global/comments/use-comment-access'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
import { useLegacyTabPreferences } from '~/components/records/layout/legacy-tab-preferences'
import { useBlockVisibility } from '~/components/records/layout/use-block-visibility'
import { useRecordLayout } from '~/components/records/layout/use-record-layout'
import { RecordLayoutEditorDialog } from '~/components/records/layout-editor'
import {
  getRecordDrillPanels,
  type RecordDrillContext,
  RecordStackProvider,
  useRecordDrillStack,
  useRecordPeekStack,
} from '~/components/records/record-drill-panels'
import { RecordIdentityHeader } from '~/components/records/ui/record-identity-header'
import { useCanViewRecordResource, useRecord, useResource } from '~/components/resources'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { TasksSection } from '~/components/tasks/ui/tasks-section'
import { TimelineTab } from '~/components/timeline'
import { useAccess } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useRecordDrawerReadOnly } from '../records/use-record-drawer-read-only'
import { LayoutBlockSection } from './blocks'
import { ThreadVisitCard } from './cards/thread-visit-card'
import { DrawerCardActionsProvider } from './drawer-card-actions'
import { getTabCardComponent, getTabComponent, isRestrictedDrawerTab } from './drawer-tab-registry'

interface BaseEntityDrawerProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId | null
  /** Drawer open state */
  open: boolean
  /** Callback when drawer open state changes */
  onOpenChange: (open: boolean) => void
  /** Optional entity type override (for system entities like 'contact') */
  entityType?: string
  /** Optional additional actions in header */
  headerActions?: React.ReactNode
  /** Optional card content to render below tabs (e.g., person card, entity card) */
  cardContent?: React.ReactNode
  /** Optional custom header icon */
  headerIcon?: React.ReactNode
  /** Optional custom header title */
  headerTitle?: string
  /** Optional callback when drawer closes */
  onClose?: () => void
  /** Optional counter to trigger focus on comments composer */
  focusComposerTrigger?: number
  /** Docked state (from `useDockStore`) — forwarded to `DockableDrawer`. */
  isDocked: boolean
  /** Docked width (from `useDockStore`) — forwarded to `DockableDrawer`. */
  dockedWidth: number
  /** Callback when docked width changes — forwarded to `DockableDrawer`. */
  onWidthChange: (width: number) => void
  /** Optional minWidth for dockable drawer */
  minWidth?: number
  /** Optional maxWidth for dockable drawer */
  maxWidth?: number
  /**
   * Restricted (read-only) mode — fields become non-editable, communication
   * panels/tabs and edit affordances hide (§11.4). Defaults to the current
   * member's derived read-only state when omitted, so drawers opened directly
   * (contact/dispatch) are also restricted for field seats.
   */
  readOnly?: boolean
}

/**
 * entityType derivation shared by the outer header (derives from the TOP
 * frame) and each `DrawerRecordFrame` (derives from its own frame) — override
 * wins, else the resource's own `entityType`, else the system resource id,
 * else 'custom'. Pulled out so the two call sites don't duplicate the same
 * three-way fallback (dispatch v4/04 §1.2, decision #9).
 */
function deriveEntityType(
  resource: Resource | undefined,
  entityTypeOverride: string | undefined
): string | null {
  if (entityTypeOverride) return entityTypeOverride
  if (!resource) return null
  // Check for entityType property first, fallback to id for system resources
  if (resource.entityType) return resource.entityType
  return resource.type === 'system' ? resource.id : 'custom'
}

interface DrawerRecordFrameProps {
  /** This frame's own record — never the null "closed" state (the outer
   * component bails before any frame mounts). */
  recordId: RecordId
  /** True for `frames[0]` — gates the host-passed `cardContent`/`entityTypeOverride`
   * (dispatch v4/04 decision #9): a peeked frame always derives from its own resource. */
  isBase: boolean
  /** Host override — applied only when `isBase`. */
  entityTypeOverride?: string
  /** Host card content (person card, entity card, etc.) — rendered only when `isBase`. */
  cardContent?: React.ReactNode
  focusComposerTrigger?: number
  /** Restricted (read-only) mode — threaded uniformly into every frame (§11.4). */
  readOnly: boolean
}

/**
 * One frame of the record peek stack (dispatch v4/04 §1.2) — a full drawer
 * body for a single record: resource/record data, entityType, drill panels,
 * the `useRecordDrillStack` two-level drill, drawer config, tabs (+ tab-order
 * persistence), and the tabbed overview body. Everything here used to live
 * directly in `BaseEntityDrawer`, computed from its single `recordId` prop;
 * now it's per-frame so a peeked record (quote, work order, …) gets its own
 * independent copy of all of it, including its own `panel`/`item` drill.
 */
function DrawerRecordFrame({
  recordId,
  isBase,
  entityTypeOverride,
  cardContent,
  focusComposerTrigger = 0,
  readOnly,
}: DrawerRecordFrameProps) {
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })
  const { hasAccess } = useFeatureFlags()
  const { can, canAdministerDef } = useAccess()
  const { canViewComments } = useCommentAccess(recordId)
  const canViewRecordResource = useCanViewRecordResource()
  const organizationId = useDehydratedOrganizationId()
  const user = useDehydratedUser()

  // Parse recordId
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Get resource metadata
  const { resource } = useResource(entityDefinitionId)

  // Get record data. `isNotFound` covers a drill/peek into a record the server
  // denies for an out-of-scope field seat (`recordsViewLinked` row scope) — the
  // batch fetch omits it, so we render a graceful "unavailable" state instead of
  // an endless skeleton (§11.4, deliverable #5).
  const { record, isNotFound, hasLoadedOnce } = useRecord({
    recordId,
    enabled: true,
  })

  // Determine entity type (override applies to the base frame only — decision #9)
  const entityType = React.useMemo(
    () => deriveEntityType(resource, isBase ? entityTypeOverride : undefined),
    [resource, isBase, entityTypeOverride]
  )

  // Drill panels registered for this entityType (dispatch v4/02) — a plain,
  // safe-to-call-statically lookup. `[]` for every entityType without one
  // (contacts, invoices, …), which keeps the render tree below byte-identical
  // to before this feature existed.
  const drillPanels = React.useMemo(
    () =>
      entityType
        ? getRecordDrillPanels(entityType).filter(
            (panel) => !panel.permissionKey || can(panel.permissionKey)
          )
        : [],
    [entityType, can]
  )

  // Shared two-level record drill (dispatch v4/02) — same `panel`/`item` nuqs
  // params as DetailViewSections, stack derivation (incl. the skip-the-list
  // direct-entry rule) shared via `useRecordDrillStack`. Naturally per-frame:
  // `useRecordPeekStack` clears `panel`/`item` on every push/pop, so a fresh
  // frame always starts at its own drill root.
  const drill = useRecordDrillStack(drillPanels)

  const drillCtx = React.useCallback(
    (): RecordDrillContext => ({
      recordId,
      entityInstanceId,
      record,
      itemId: drill.item,
      setItemId: drill.setItem,
      close: drill.clear,
    }),
    [recordId, entityInstanceId, record, drill.item, drill.setItem, drill.clear]
  )

  // Get drawer config from registry
  const drawerConfig = React.useMemo(() => {
    if (!entityType) return null
    return getEntityDrawerConfig(entityType, entityDefinitionId ?? undefined)
  }, [entityType, entityDefinitionId])

  // ── The resolved layout (plans/drawer/record-layout-system.md §5) ─────────
  // The registry default under the org and personal deltas. This REPLACES the
  // hardcoded tab list, the `TabCards` calls and the literal Details section:
  // every one of them is now a block on a tab.
  // The pre-layout-system localStorage tab order enters here as the personal
  // layer rather than being applied after the fact, which is what keeps tab
  // order to one source of truth (§2).
  const legacyTabPreferences = useLegacyTabPreferences(organizationId, user?.id, entityDefinitionId)

  const { layout } = useRecordLayout({
    entityDefinitionId,
    entityType: entityType ?? '',
    surface: 'drawer',
    drawerConfig: drawerConfig ?? undefined,
    canViewComments,
    fallbackUserDelta: legacyTabPreferences,
  })

  const [layoutEditorOpen, setLayoutEditorOpen] = React.useState(false)

  const isBlockVisible = useBlockVisibility({ entityType: entityType ?? '', readOnly })

  // Registry tab definitions by id, for the gates a `ResolvedLayoutTab` does not
  // carry. Placement is layout data; capability is always read back from the
  // registry entry (§5, "the hard invariant").
  const tabDefinitions = React.useMemo(() => {
    const map = new Map<string, DrawerTabDefinition>()
    for (const tab of drawerConfig?.additionalTabs ?? []) map.set(tab.value, tab)
    return map
  }, [drawerConfig])

  /**
   * Whether a tab that mounts a component of its own is allowed for this viewer.
   *
   * The four registry gates the old `visibleAdditionalTabs` filter applied, now
   * evaluated per tab. A tab that IS its blocks (`hasOwnComponent: false`) never
   * reaches this: its visibility is derived from its blocks instead (§7).
   */
  const isTabAllowed = React.useCallback(
    (tab: ResolvedLayoutTab) => {
      const definition = tabDefinitions.get(tab.id)
      if (!definition) return true
      if (definition.featureGate && !hasAccess(definition.featureGate)) return false
      if (definition.permissionKey && !can(definition.permissionKey)) return false
      return canViewRecordResource(definition.recordResource)
    },
    [tabDefinitions, hasAccess, can, canViewRecordResource]
  )

  const visibilityCtx = React.useMemo<TabVisibilityContext>(
    () => ({ isBlockVisible, isTabAllowed }),
    [isBlockVisible, isTabAllowed]
  )

  // Tab visibility is DERIVED (§7): a tab of blocks renders only while one of
  // its blocks is visible for this viewer. CSS cannot answer this: the
  // empty-section rule hides a section AFTER it renders nothing, so a tab whose
  // every block is gated out would still show as a clickable empty tab.
  //
  // Restricted mode is applied on top because `isTabVisible` short-circuits base
  // tabs (timeline / comments / tasks) before consulting the context, and those
  // are exactly the tabs §11.4 drops for a field seat.
  // Hidden tabs are kept here and handed to the strip separately, because
  // `OverflowTabsList` excepts the ACTIVE tab from its hidden set: that is what
  // lets a deep link into a tab this viewer hid still resolve instead of
  // silently redirecting to Overview. Filtering them out here would look
  // equivalent and quietly drop that.
  const visibleTabs = React.useMemo(
    () =>
      permittedLayoutTabs(layout, visibilityCtx).filter(
        (tab) => !readOnly || !isRestrictedDrawerTab(entityType ?? '', tab.id)
      ),
    [layout, visibilityCtx, readOnly, entityType]
  )

  const hiddenTabIds = React.useMemo(
    () => visibleTabs.filter((tab) => tab.hidden).map((tab) => tab.id),
    [visibleTabs]
  )

  const tabs = React.useMemo(
    (): TabDefinition[] =>
      visibleTabs.map((tab) => ({
        value: tab.id,
        label: tab.label,
        // Union lookup, not `getIconComponent`: an ADMIN-created tab's icon comes
        // from the picker's table (`ICON_DATA`), which only partly overlaps the
        // registry's `ICON_MAP`, so resolving through the map alone renders every
        // picked icon as the generic fallback box.
        icon: resolveLayoutIcon(tab.icon) ?? Circle,
        // Overview is un-hideable: it's the fallback `effectiveTab` resolves to,
        // and it's the only tab guaranteed to exist for every entity type.
        hideable: tab.hideable,
      })),
    [visibleTabs]
  )

  // Tab ORDER and hiding are resolved upstream, in `useRecordLayout`: the
  // legacy `tabOrder:{org}:{user}:{def}` localStorage value is fed in as the
  // personal layer (see `useLegacyTabPreferences`) and merged there. That is
  // the plan's §2 requirement, and the reason there is no second ordering pass
  // here: `layout.tabs` already arrives in the viewer's order, so re-sorting it
  // locally would be the second source of truth this system exists to remove.

  // A `?tab=` pointing at a tab this viewer can't see (a stale deep link, or a
  // frame whose entity type has no such tab) must not render a blank body.
  // Resolved locally and deliberately NOT written back to the URL: every frame
  // of the peek stack shares this one query param, so a write here would clobber
  // the frame underneath.
  const effectiveTab = tabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (tabs[0]?.value ?? 'overview')

  // The editor writes both scopes, so any member may open it: personal tab
  // order and hiding is theirs, section placement is def-admin only, and the
  // dialog itself draws that line (§9.5). Gating the cog on def-admin would
  // take the working per-user feature away from ordinary members.
  const canOpenLayoutEditor = Boolean(organizationId && user?.id && entityDefinitionId)

  if (!drawerConfig || !entityType) return null

  // Restricted drill/peek into an out-of-scope record: the server denied the
  // fetch (row scope), so show a graceful message rather than an endless
  // skeleton. Gated on `readOnly` so full members keep byte-identical behavior
  // for genuinely deleted records (deliverable #5).
  if (readOnly && hasLoadedOnce && isNotFound) {
    return (
      <div className='flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground'>
        This record isn’t available with your current access.
      </div>
    )
  }

  // The existing tabbed overview body — rendered verbatim whether or not this
  // entityType has drill panels, so it becomes the root NavStackPanel's
  // content when it does (byte-identical render otherwise).
  const tabsBlock = (
    <Tabs value={effectiveTab} onValueChange={setActiveTab} className='w-full h-full'>
      <div className='w-full h-full flex gap-0'>
        <div className='w-full h-full flex flex-col overflow-auto justify-start'>
          <OverflowTabsList
            tabs={tabs}
            value={effectiveTab}
            onValueChange={setActiveTab}
            variant='outline'
            hidden={hiddenTabIds}
            canCustomize={canOpenLayoutEditor}
            onOpenCustomize={() => setLayoutEditorOpen(true)}
          />

          {/* Mounted only while open: the editor builds its own working model
              from the registry plus the stored deltas, so keeping it mounted
              would hold a stale session across record switches. */}
          {canOpenLayoutEditor && entityDefinitionId && layoutEditorOpen && (
            <RecordLayoutEditorDialog
              open={layoutEditorOpen}
              onOpenChange={setLayoutEditorOpen}
              entityDefinitionId={entityDefinitionId}
              entityType={entityType}
              surface='drawer'
              layout={layout}
              canAdministerDef={canAdministerDef(entityDefinitionId)}
            />
          )}

          {/* Identity header (avatar + display name + secondary line). The HOST's
              `cardContent` is base-frame only (decision #9) — a peeked frame must
              derive from its own resource, not the opener's. It still needs a
              name though: without one, drilling into a supplier/part lands on a
              header reading only the resource label ("Supplier") with the record's
              name nowhere but a Details row. Every host's `cardContent` today IS a
              `RecordIdentityHeader`, so a peeked frame renders the bare one against
              its own `recordId`. */}
          {isBase ? cardContent : <RecordIdentityHeader recordId={recordId} readOnly={readOnly} />}

          <div className='flex flex-1 overflow-hidden'>
            {/* Base tabs render hard-coded content and accept no blocks (§9.3).
                They are mounted unconditionally rather than from `visibleTabs`
                so a tab dropped from the STRIP has no mountable content either
                (the `!readOnly && canViewComments` guard below is that rule for
                comments, which a stale `?tab=comments` deep link could otherwise
                surface). */}
            <TabsContent value='timeline' className='w-full h-full mt-0'>
              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <div className='p-3 flex-1 flex-col flex'>
                  <TimelineTab
                    recordId={recordId}
                    excludeEventTypes={readOnly ? COMMUNICATION_TIMELINE_EVENT_TYPES : undefined}
                  />
                </div>
              </ScrollArea>
            </TabsContent>

            {!readOnly && canViewComments && (
              <TabsContent value='comments' className='w-full h-full mt-0'>
                <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                  <DrawerComments recordId={recordId} focusComposerTrigger={focusComposerTrigger} />
                </ScrollArea>
              </TabsContent>
            )}

            <TabsContent value='tasks' className='w-full h-full mt-0'>
              <TasksSection recordId={recordId} />
            </TabsContent>

            {/* Every non-base tab, rendered from the RESOLVED LAYOUT: its
                `before` blocks, its own lazy component when it has one, then its
                `after` blocks. This subsumes the old `TabCards` calls, the
                literal Details section (now the `core:details` block Overview
                carries) and the `additionalTabs` map, which is why a section can
                finally live on a tab other than Overview. */}
            {visibleTabs
              .filter((tab) => !tab.isBaseTab)
              .map((tab) => (
                <LayoutTabContent
                  key={tab.id}
                  tab={tab}
                  blocks={visibleTabBlocks(tab, visibilityCtx)}
                  entityType={entityType}
                  entityInstanceId={entityInstanceId}
                  recordId={recordId}
                  record={record}
                  readOnly={readOnly}
                />
              ))}
          </div>
        </div>
      </div>
    </Tabs>
  )

  return drillPanels.length === 0 ? (
    <div className='flex-1 overflow-y-auto'>{tabsBlock}</div>
  ) : (
    <NavStack
      stack={drill.stack}
      onStackChange={drill.onStackChange}
      className='flex flex-col flex-1 min-h-0'>
      {/* Root has no bar (its OverflowTabsList lives in tabsBlock, not a
          bar slot) — only mount NavStackBar once a drill panel is on top,
          so root stays a byte-identical empty strip-free render. */}
      {drill.stack.length > 1 && <NavStackBar className='shrink-0 border-b' />}
      <NavStackPanels className='flex-1 min-h-0'>
        <NavStackPanel value='root' className='h-full overflow-y-auto'>
          {tabsBlock}
        </NavStackPanel>

        {drillPanels.map((dp) => (
          <NavStackPanel
            key={dp.value}
            value={dp.value}
            className='h-full flex flex-col bg-neutral-100 dark:bg-background'
            bar={typeof dp.bar === 'function' ? dp.bar(drillCtx()) : dp.bar}>
            {dp.render(drillCtx())}
          </NavStackPanel>
        ))}

        {drillPanels
          .filter((dp) => dp.renderItem)
          .map((dp) => (
            <NavStackPanel
              key={`${dp.value}:item`}
              value={`${dp.value}:item`}
              className='h-full flex flex-col bg-neutral-100 dark:bg-background'
              bar={typeof dp.bar === 'function' ? dp.bar(drillCtx()) : dp.bar}>
              {dp.renderItem?.(drillCtx())}
            </NavStackPanel>
          ))}
      </NavStackPanels>
    </NavStack>
  )
}

/**
 * Base entity drawer that uses registry-based configuration
 * Supports both system entities (contact, part) and custom entities
 *
 * Owns `DockableDrawer`/`DrawerHeader` (stable across pushes — no drawer
 * close/reopen flicker) and the cross-record peek stack (dispatch v4/04):
 * `frames = [recordId, ...peek]`, each rendered by its own `DrawerRecordFrame`
 * inside an outer `NavStack` that slides between them. The header derives
 * from the TOP frame — it replaces instantly, no slide (decision #4) — while
 * the body animates via the existing NavStack push/pop parallax.
 */
export function BaseEntityDrawer({
  recordId,
  open,
  onOpenChange,
  entityType: entityTypeOverride,
  headerActions,
  cardContent,
  headerIcon,
  headerTitle,
  onClose,
  focusComposerTrigger = 0,
  isDocked,
  dockedWidth,
  onWidthChange,
  minWidth = 400,
  maxWidth = 800,
  readOnly: readOnlyProp,
}: BaseEntityDrawerProps) {
  // Restricted (read-only) mode — the explicit prop from `RecordDrawer` wins;
  // fall back to the member's derived per-def state so drawers opened directly
  // (contact, dispatch board) are restricted for field seats / Read-only grantees
  // too (§11.4). Derived from the BASE record's def: one flag for the whole frame
  // stack, so a drilled record inherits the parent's read-only state.
  const baseParsed = recordId ? parseRecordId(recordId) : undefined
  const derivedReadOnly = useRecordDrawerReadOnly(
    baseParsed?.entityDefinitionId,
    baseParsed?.entityInstanceId
  )
  const readOnly = readOnlyProp ?? derivedReadOnly

  // Cross-record peek stack — `frames = [recordId, ...peek]`. Called
  // unconditionally (recordId may be null while the drawer is closed).
  const peek = useRecordPeekStack(recordId)
  const { frames, top, depth } = peek
  const isBaseTop = depth <= 1
  const router = useRouter()

  // Header derives from the TOP frame (decision #4/#9) — its own resource
  // lookup, independent of whichever frame is deeper in the stack.
  const topParsed = top ? parseRecordId(top) : null
  const { resource: topResource } = useResource(topParsed?.entityDefinitionId ?? null)
  const topEntityType = React.useMemo(
    () => deriveEntityType(topResource, isBaseTop ? entityTypeOverride : undefined),
    [topResource, isBaseTop, entityTypeOverride]
  )

  // Expand-to-full-page affordance for peeked frames (decision #7, Phase 2) —
  // `useRecordLink` must be called unconditionally (hooks rule); the button
  // itself only renders when peeked AND the link is non-null (service_request,
  // invoice have no detail page).
  const topRecordLink = useRecordLink(top)

  /** Handle close — also clears the peek stack (which clears `tab`/`panel`/`item` too) so a re-open lands on a fresh single-frame stack. */
  const handleClose = React.useCallback(() => {
    peek.clear()
    if (onClose) {
      onClose()
    } else {
      onOpenChange(false)
    }
  }, [onClose, onOpenChange, peek.clear])

  // DockableDrawer's own close paths (outside click, swipe, Escape in
  // undocked mode) call `onOpenChange` directly, bypassing `handleClose` —
  // clear the peek stack there too.
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) peek.clear()
      onOpenChange(nextOpen)
    },
    [onOpenChange, peek.clear]
  )

  // Clear a stale peek stack when the drawer's BASE record changes while open
  // (e.g. clicking a different sidebar row without closing the drawer first)
  // — but NOT on initial mount, so a cold-load deep link (?record=…&peek=…)
  // survives. `peek.clear()` resets `tab`/`panel`/`item` too, so a new base
  // record always lands on a fresh single-frame stack. Rendering doesn't wait
  // for this effect: `useRecordPeekStack` already drops the stale frames at
  // render time (one 'replace' update), this just syncs the URL params.
  const prevRecordIdRef = React.useRef(recordId)
  React.useEffect(() => {
    const prevRecordId = prevRecordIdRef.current
    if (prevRecordId && recordId && prevRecordId !== recordId) {
      peek.clear()
    }
    prevRecordIdRef.current = recordId
  }, [recordId, peek.clear])

  // Nothing drives the outer NavStack's own push/pop directly in Phase 1
  // (Phase 2's header back-chevron will, via `peek.pop`) — this only guards
  // against the stack shrinking out from under the URL state, keeping `peek`
  // truncated to match.
  const handleFrameStackChange = React.useCallback(
    (next: string[]) => {
      if (next.length < frames.length) peek.pop()
    },
    [frames.length, peek.pop]
  )

  const stackCtx = React.useMemo(() => ({ push: peek.push, depth }), [peek.push, depth])

  if (!open || !recordId || !top || !topEntityType) return null

  const displayHeaderTitle = isBaseTop
    ? (headerTitle ?? topResource?.label ?? 'Record')
    : (topResource?.label ?? 'Record')
  // `resource.icon` is an icon ID string — always render it through EntityIcon
  // (the host `headerIcon` prop is already a rendered element).
  const resourceHeaderIcon = (
    <EntityIcon
      iconId={topResource?.icon || 'circle'}
      color={topResource?.color || 'gray'}
      className='size-6'
    />
  )
  const displayHeaderIcon = isBaseTop ? (headerIcon ?? resourceHeaderIcon) : resourceHeaderIcon

  return (
    <DockableDrawer
      open={open}
      onOpenChange={handleOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={onWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title={displayHeaderTitle}>
      <DrawerHeader
        icon={displayHeaderIcon}
        title={displayHeaderTitle}
        onClose={handleClose}
        onBack={isBaseTop ? undefined : peek.pop}
        actions={
          <>
            {isBaseTop && headerActions}
            {!readOnly && <AppRecordActions recordId={top} recordType={topEntityType} compact />}
            {!isBaseTop && topRecordLink && (
              <Tooltip content='Open full page'>
                <Button variant='ghost' size='icon-xs' onClick={() => router.push(topRecordLink)}>
                  <ExternalLink />
                </Button>
              </Tooltip>
            )}
            <DockToggleButton />
          </>
        }
      />

      {/* Frame stack — index-qualified keys (`0:<recordId>`) so pushing an
          already-visited record (truncate, dispatch v4/04 decision #6) can't
          collide with a stale key from deeper in the stack. Mounted
          unconditionally (not gated on `depth > 1`): `NavStackPanels`'
          `AnimatePresence` uses `initial={false}`, so gating the NavStack's
          own mount on depth would skip the very first push's animation. */}
      <RecordStackProvider value={stackCtx}>
        <NavStack
          stack={frames.map((id, i) => `${i}:${id}`)}
          onStackChange={handleFrameStackChange}
          className='flex flex-col flex-1 min-h-0'>
          <NavStackPanels className='flex-1 min-h-0'>
            {/* Panels are `flex flex-col`, NOT `overflow-y-auto`: the frame
                bodies were built as direct DockableDrawer flex-column children
                (`flex-1 overflow-y-auto` root / inner drill NavStack) and manage
                their own scroll — a scrolling panel here would collapse that
                height chain and let the drill back-bar scroll away. */}
            {frames.map((id, i) => (
              <NavStackPanel
                key={`${i}:${id}`}
                value={`${i}:${id}`}
                className='h-full flex flex-col'>
                <DrawerRecordFrame
                  recordId={id}
                  isBase={i === 0}
                  entityTypeOverride={entityTypeOverride}
                  cardContent={cardContent}
                  focusComposerTrigger={focusComposerTrigger}
                  readOnly={readOnly}
                />
              </NavStackPanel>
            ))}
          </NavStackPanels>
        </NavStack>
      </RecordStackProvider>
    </DockableDrawer>
  )
}

/**
 * The Details panel's one piece of chrome that is not part of the block model:
 * the extra right padding the literal `<Section title='Details'>` carried.
 *
 * `LayoutBlockSection` takes no `className` (a stored layout must not be able to
 * restyle a block), so this is applied from the parent instead. The selector
 * walks Section's own DOM (wrapper, then body), which is why it is three levels
 * deep rather than the two the old inline version used from inside the Section.
 */
const DETAILS_BLOCK_PADDING =
  '[&>[data-slot=section-wrapper]>[data-slot=section]>[data-slot=section-content]]:pe-4'

/**
 * One non-base tab's body, composed from the resolved layout
 * (`plans/drawer/record-layout-system.md` §4).
 *
 * Render order is `before` blocks, the tab's own lazy component when it has one,
 * then `after` blocks: the same before/after split `TabCards` applied, now
 * available on every tab rather than only Overview.
 *
 * **Scroll.** A tab that carries blocks gets its own `ScrollArea`; a tab that is
 * only its registered component does not. That keeps Overview byte-identical
 * (it always carries the Details block, so it always gets the wrapper it has
 * today) and keeps every existing additional tab byte-identical too (they carry
 * no blocks, and each already manages its own scroll: `ContactTicketsTab` and
 * friends own a `ScrollArea` of their own, so wrapping them in a second one
 * would collapse their height chain). Sections placed on an additional tab would
 * otherwise grow the body unbounded, which is the case this fixes. Scroll
 * ownership stays PER TAB here, so `plans/drawer/scroll-area-ownership.md`, which
 * is not in scope, is neither implemented nor made harder.
 */
function LayoutTabContent({
  tab,
  blocks,
  entityType,
  entityInstanceId,
  recordId,
  record,
  readOnly,
}: {
  tab: ResolvedLayoutTab
  /** The blocks of this tab this viewer may see, in render order. */
  blocks: LayoutBlock[]
  entityType: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
  readOnly?: boolean
}) {
  const renderBlock = (block: LayoutBlock) => {
    const section = (
      <LayoutBlockSection
        block={block}
        entityType={entityType}
        entityInstanceId={entityInstanceId}
        recordId={recordId}
        record={record}
        readOnly={readOnly}
      />
    )
    return (
      <React.Fragment key={block.id}>
        {block.id === DETAILS_BLOCK_ID ? (
          <div className={DETAILS_BLOCK_PADDING}>{section}</div>
        ) : (
          section
        )}
        {/* Context card: visit facts when opened over a chat thread. Pinned to
            the Details block rather than to a tab id, so it keeps sitting
            directly under the field panel wherever an admin moves it. */}
        {block.id === DETAILS_BLOCK_ID && (
          <ThreadVisitCard
            contactInstanceId={entityType === 'contact' ? entityInstanceId : undefined}
          />
        )}
      </React.Fragment>
    )
  }

  const body = (
    <>
      {blocks.filter((block) => block.position === 'before').map(renderBlock)}
      {tab.hasOwnComponent && (
        <LazyTabComponent
          entityType={entityType}
          tabValue={tab.id}
          entityInstanceId={entityInstanceId}
          recordId={recordId}
          record={record}
        />
      )}
      {blocks.filter((block) => block.position !== 'before').map(renderBlock)}
    </>
  )

  return (
    <TabsContent value={tab.id} className='w-full'>
      {blocks.length > 0 ? (
        <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
          {body}
        </ScrollArea>
      ) : (
        body
      )}
    </TabsContent>
  )
}

/**
 * Lazy load and render a tab component
 */
function LazyTabComponent({
  entityType,
  tabValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  tabValue: string
  entityInstanceId: string
  recordId: string
  record?: Record<string, unknown>
}) {
  const componentLoader = getTabComponent(entityType, tabValue)

  if (!componentLoader) {
    return <div className='p-4 text-sm text-muted-foreground'>Tab component not found</div>
  }

  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!Component) {
    return (
      <div className='flex items-center justify-center p-4'>
        <Loader size='sm' />
      </div>
    )
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}

/**
 * A card that rendered NOTHING hides its whole Section, header included.
 *
 * The header lives outside the card, so a card that returns `null` — the
 * documented behaviour of several of them (`ContactExternalIdentitiesCard` with
 * no linked apps, `ContactSharedWithCard` for a non-admin with no shares) — left
 * its title stranded above blank space. `detail-view-config.ts` even documents
 * these cards as "renders nothing", which was only ever true of the BODY.
 *
 * Done in CSS rather than by asking cards to report emptiness upward: `:empty`
 * is exactly the question ("did this card put any node on the page?"), it needs
 * no cooperation from ~20 card components, and a card that renders a deliberate
 * empty state (`EmptyRow`, `EmptySection`) is not empty and still shows its
 * header. `collapsible={false}` keeps `section-content` mounted, so the match is
 * stable rather than a side effect of the open state.
 */
const HIDE_WHEN_CARD_RENDERS_NOTHING = '[&:has([data-slot=section-content]:empty)]:hidden'

/**
 * A single tab card wrapped in its Section. Owns the Section header's actions-slot
 * element and exposes it to the lazily-loaded card via `DrawerCardActionsProvider`,
 * so the card can portal buttons into the header (see `DrawerCardActions`).
 * Exported for surfaces that replay a drawer's card list outside the drawer
 * itself (e.g. `InvoiceDetailPanel`, `DetailViewSidebar`).
 */
export function TabCardSection({
  card,
  entityType,
  entityInstanceId,
  recordId,
  record,
}: {
  card: DrawerTabCardDefinition
  entityType: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null)

  return (
    <Section
      title={card.label}
      icon={
        card.icon ? (
          <>{React.createElement(getIconComponent(card.icon), { className: 'size-4' })}</>
        ) : undefined
      }
      initialOpen
      collapsible={false}
      actions={<span ref={setActionsEl} className='contents' />}
      className={cn(
        HIDE_WHEN_CARD_RENDERS_NOTHING,
        card.fullBleed &&
          '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3 [&>[data-slot=section]>[data-slot=section-content]]:-mb-4'
      )}>
      <DrawerCardActionsProvider value={actionsEl}>
        <LazyTabCard
          entityType={entityType}
          cardValue={card.value}
          entityInstanceId={entityInstanceId}
          recordId={recordId}
          record={record}
        />
      </DrawerCardActionsProvider>
    </Section>
  )
}

/**
 * Lazy load and render a tab card component
 */
function LazyTabCard({
  entityType,
  cardValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  cardValue: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const componentLoader = getTabCardComponent(entityType, cardValue)

  if (!componentLoader) return null

  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    componentLoader().then((mod) => setComponent(() => mod.default))
  }, [componentLoader])

  if (!Component) {
    return (
      <div className='flex items-center justify-center p-2'>
        <Loader size='sm' />
      </div>
    )
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}
