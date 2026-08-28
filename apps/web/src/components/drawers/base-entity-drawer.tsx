// apps/web/src/components/drawers/base-entity-drawer.tsx
'use client'

import type { DrawerTabCardDefinition, Resource } from '@auxx/lib/resources/client'
import { getEntityDrawerConfig, parseRecordId } from '@auxx/lib/resources/client'
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
import { Clock, ExternalLink, HouseIcon, ListTodo, MessagesSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { AppRecordActions } from '~/components/detail-view/components/app-record-actions'
import { getIconComponent } from '~/components/detail-view/utils'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { useCommentAccess } from '~/components/global/comments/use-comment-access'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import {
  getRecordDrillPanels,
  type RecordDrillContext,
  RecordStackProvider,
  useRecordDrillStack,
  useRecordPeekStack,
} from '~/components/records/record-drill-panels'
import { useCanViewRecordResource, useRecord, useResource } from '~/components/resources'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { TasksSection } from '~/components/tasks/ui/tasks-section'
import { TimelineTab } from '~/components/timeline'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { useAccess } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useRecordDrawerReadOnly } from '../records/use-record-drawer-read-only'
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
 * Apply a saved tab order to a tabs array.
 * Tabs in savedOrder come first, in that order.
 * Tabs NOT in savedOrder (new tabs added after user last saved) are appended at the end.
 * Saved values that no longer exist are silently dropped.
 */
function applyTabOrder(tabs: TabDefinition[], savedOrder: string[]): TabDefinition[] {
  const tabMap = new Map(tabs.map((t) => [t.value, t]))
  const ordered: TabDefinition[] = []
  for (const value of savedOrder) {
    const tab = tabMap.get(value)
    if (tab) {
      ordered.push(tab)
      tabMap.delete(value)
    }
  }
  for (const tab of tabs) {
    if (tabMap.has(tab.value)) ordered.push(tab)
  }
  return ordered
}

/** Stable empty array so an uncustomized drawer doesn't hand OverflowTabsList a
 *  fresh `hidden` reference on every render. */
const EMPTY_HIDDEN_TABS: string[] = []

/** Per-viewer, per-entity-definition tab customization, as stored in localStorage. */
interface TabPreferences {
  /** Tab values in the viewer's chosen order. */
  order: string[]
  /** Tab values the viewer hid from the strip. */
  hidden: string[]
}

/**
 * Read the stored tab preferences, tolerating the legacy shape.
 *
 * Before show/hide existed the key held a bare `string[]` of tab values, so an
 * array is read as order-only with nothing hidden — the upgrade is silent and
 * costs no migration. Anything unparseable falls back to defaults.
 */
function parseTabPreferences(raw: string | null): TabPreferences | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { order: parsed, hidden: [] }
    if (parsed && typeof parsed === 'object') {
      return {
        order: Array.isArray(parsed.order) ? parsed.order : [],
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      }
    }
  } catch {
    // Invalid JSON, fall through to defaults
  }
  return null
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
  const { can } = useAccess()
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

  // The registry tabs this viewer may see — resolved ONCE so the tab strip and
  // the rendered TabsContent below can never disagree. A `recordResource` tab
  // lists another definition's records, so it is gated on that definition's read
  // level: with `tickets: None` the contact drawer must not offer a Tickets tab
  // at all (an always-empty tab fronting a Create button reads as a bug).
  const visibleAdditionalTabs = React.useMemo(
    () =>
      (drawerConfig?.additionalTabs ?? [])
        .filter((tab) => !tab.featureGate || hasAccess(tab.featureGate))
        .filter((tab) => !readOnly || !isRestrictedDrawerTab(entityType ?? '', tab.value))
        .filter((tab) => canViewRecordResource(tab.recordResource)),
    [drawerConfig, hasAccess, readOnly, entityType, canViewRecordResource]
  )

  // Build tabs from registry + base tabs
  const tabs = React.useMemo(() => {
    if (!drawerConfig) return []

    // Overview is un-hideable: it's the fallback `effectiveTab` resolves to, and
    // it's the only tab guaranteed to exist for every entity type.
    const overviewTab = {
      value: 'overview',
      label: 'Overview',
      icon: HouseIcon,
      hideable: false,
    }
    const trailingTabs = [
      { value: 'timeline', label: 'Timeline', icon: Clock },
      { value: 'comments', label: 'Comments', icon: MessagesSquare },
      { value: 'tasks', label: 'Tasks', icon: ListTodo },
    ]
      // Restricted mode drops the communication/comment tabs (§11.4).
      .filter((tab) => !readOnly || !isRestrictedDrawerTab(entityType ?? '', tab.value))
      .filter((tab) => tab.value !== 'comments' || canViewComments)

    const additionalTabs = visibleAdditionalTabs.map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: getIconComponent(tab.icon),
    }))

    // Overview first, then entity-specific tabs, then the shared timeline/comments/tasks tabs
    return [overviewTab, ...additionalTabs, ...trailingTabs]
  }, [drawerConfig, visibleAdditionalTabs, readOnly, entityType, canViewComments])

  // Tab order persistence
  const tabOrderStorageKey = React.useMemo(() => {
    if (!organizationId || !user?.id || !entityDefinitionId) return null
    return `tabOrder:${organizationId}:${user.id}:${entityDefinitionId}`
  }, [organizationId, user?.id, entityDefinitionId])

  const [tabPreferences, setTabPreferences] = React.useState<TabPreferences | null>(null)

  React.useEffect(() => {
    if (!tabOrderStorageKey) {
      setTabPreferences(null)
      return
    }
    setTabPreferences(parseTabPreferences(safeLocalStorage.get(tabOrderStorageKey)))
  }, [tabOrderStorageKey])

  const orderedTabs = React.useMemo(() => {
    const savedOrder = tabPreferences?.order
    if (!savedOrder || savedOrder.length === 0) return tabs
    return applyTabOrder(tabs, savedOrder)
  }, [tabs, tabPreferences])

  // Hidden values for tabs that no longer exist are harmless (OverflowTabsList
  // only ever matches them against real tabs), so they're kept as-is — a tab
  // gated off today may come back tomorrow, and dropping them would silently
  // un-hide it.
  const hiddenTabs = tabPreferences?.hidden ?? EMPTY_HIDDEN_TABS

  // A `?tab=` pointing at a tab this viewer can't see (a stale deep link, or a
  // frame whose entity type has no such tab) must not render a blank body.
  // Resolved locally and deliberately NOT written back to the URL: every frame
  // of the peek stack shares this one query param, so a write here would clobber
  // the frame underneath.
  const effectiveTab = orderedTabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (orderedTabs[0]?.value ?? 'overview')

  const handleCustomizeTabs = React.useCallback(
    (next: TabPreferences) => {
      setTabPreferences(next)
      if (tabOrderStorageKey) {
        safeLocalStorage.set(tabOrderStorageKey, JSON.stringify(next))
      }
      // Hiding the tab you're standing on shouldn't leave it revealed — that
      // reveal is reserved for deep links arriving at a hidden tab. Move to the
      // first tab that survives the new hidden set instead.
      if (next.hidden.includes(effectiveTab)) {
        const fallback = next.order.find((value) => !next.hidden.includes(value))
        if (fallback) setActiveTab(fallback)
      }
    },
    [tabOrderStorageKey, effectiveTab, setActiveTab]
  )

  const handleResetTabs = React.useCallback(() => {
    setTabPreferences(null)
    if (tabOrderStorageKey) {
      safeLocalStorage.remove(tabOrderStorageKey)
    }
  }, [tabOrderStorageKey])

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
            tabs={orderedTabs}
            value={effectiveTab}
            onValueChange={setActiveTab}
            variant='outline'
            canCustomize={!!tabOrderStorageKey}
            hidden={hiddenTabs}
            onCustomize={handleCustomizeTabs}
            onReset={handleResetTabs}
          />

          {/* Card content (person card, entity card, etc.) — base frame only (decision #9) */}
          {isBase && cardContent}

          <div className='flex flex-1 overflow-hidden'>
            {/* Base tabs - static */}
            <TabsContent value='overview' className='w-full'>
              <ScrollArea className='flex-1' scrollbarClassName='w-1!'>
                <TabCards
                  tab='overview'
                  position='before'
                  entityType={entityType}
                  drawerConfig={drawerConfig}
                  entityInstanceId={entityInstanceId}
                  recordId={recordId}
                  record={record}
                  readOnly={readOnly}
                />
                <Section
                  title='Details'
                  className='[&>[data-slot=section]>[data-slot=section-content]]:pe-4'
                  initialOpen
                  collapsible={false}
                  icon={<HouseIcon className='size-4' />}>
                  <EntityFields recordId={recordId} readOnly={readOnly} canEdit={!readOnly} />
                </Section>
                {/* Context card: visit facts when opened over a chat thread */}
                <ThreadVisitCard
                  contactInstanceId={entityType === 'contact' ? entityInstanceId : undefined}
                />
                <TabCards
                  tab='overview'
                  position='after'
                  entityType={entityType}
                  drawerConfig={drawerConfig}
                  entityInstanceId={entityInstanceId}
                  recordId={recordId}
                  record={record}
                  readOnly={readOnly}
                />
              </ScrollArea>
            </TabsContent>

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

            {/* Comments tab is dropped from the tab bar in restricted mode; keep
                its content unmounted too so a stale `?tab=comments` deep link
                can't surface it. */}
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

            {/* Dynamic tabs from registry — same filtered list as the strip, so a
                gated-out tab has no mountable content either. */}
            {visibleAdditionalTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className='w-full'>
                <LazyTabComponent
                  entityType={entityType}
                  tabValue={tab.value}
                  entityInstanceId={entityInstanceId}
                  recordId={recordId}
                  record={record}
                />
              </TabsContent>
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
 * Renders tab cards for a given base tab at the specified position (before/after default content)
 */
function TabCards({
  tab,
  position,
  entityType,
  drawerConfig,
  entityInstanceId,
  recordId,
  record,
  readOnly,
}: {
  tab: string
  position: 'before' | 'after'
  entityType: string
  drawerConfig: { tabCards?: Record<string, DrawerTabCardDefinition[]> }
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
  readOnly?: boolean
}) {
  const { can } = useAccess()
  const canViewRecordResource = useCanViewRecordResource()
  const cards = drawerConfig.tabCards?.[tab]
    ?.filter((c) => (c.position ?? 'after') === position)
    // Restricted mode drops communication overview cards (e.g. work_order:communications).
    .filter((c) => !readOnly || !isRestrictedDrawerTab(entityType, c.value))
    // Layer-2 capability gate — hide the whole section (header included) when the
    // viewer lacks the key, mirroring the card's router procedure gate.
    .filter((c) => !c.permissionKey || can(c.permissionKey))
    // Layer-3 per-definition gate for cards that are purely another definition's
    // records (service_request work orders/quotes, quote jobs).
    .filter((c) => canViewRecordResource(c.recordResource))
  if (!cards?.length) return null

  return (
    <>
      {cards.map((card) => (
        <TabCardSection
          key={card.value}
          card={card}
          entityType={entityType}
          entityInstanceId={entityInstanceId}
          recordId={recordId}
          record={record}
        />
      ))}
    </>
  )
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
