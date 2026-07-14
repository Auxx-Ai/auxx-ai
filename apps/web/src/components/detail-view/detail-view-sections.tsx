// apps/web/src/components/detail-view/detail-view-sections.tsx
'use client'

import { NavStack, NavStackBar, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  type RecordDrillContext,
  type RecordDrillPanel,
  useRecordDrillStack,
} from '~/components/records/record-drill-panels'
import { parseRecordId, type RecordId } from '~/components/resources'
import { useScrollSpy } from '~/hooks/use-scroll-spy'
import { getDetailViewTabComponent } from './detail-view-tab-registry'
import type { DetailViewMainTabsProps, DetailViewTabProps } from './types'
import { getIconComponent } from './utils'

// Same rationale as agent-detail-tabs.tsx (the reference wiring, dispatch M2 build
// spec §F.1 "verbatim" structure): the tab strip lives in <NavStackBar>, OUTSIDE the
// ScrollArea viewport, so the viewport's top edge already starts below the tabs — no
// offset needed to land a section flush at the top.
const SCROLL_BUFFER = 0
// Activate a tab once its section crosses just past the top edge.
const SPY_BUFFER = 8

interface SectionChromeSlots {
  titleSlot: HTMLElement | null
  actionsSlot: HTMLElement | null
}

// Slot elements inside the wrapping <Section> header, provided per section so a
// registered tab component can contribute chrome without owning the header.
// Default nulls make the portal components no-ops under DetailViewMainTabs.
const SectionChromeContext = React.createContext<SectionChromeSlots>({
  titleSlot: null,
  actionsSlot: null,
})

/**
 * Portals `children` next to the wrapping `<Section>` title (e.g. a status badge).
 * Only renders under `layout: 'sections'` — a no-op inside DetailViewMainTabs.
 */
export function DetailSectionTitleExtra({ children }: { children: React.ReactNode }) {
  const { titleSlot } = React.useContext(SectionChromeContext)
  return titleSlot ? createPortal(children, titleSlot) : null
}

/**
 * Portals `children` into the wrapping `<Section>`'s right-aligned header actions.
 * Only renders under `layout: 'sections'` — a no-op inside DetailViewMainTabs.
 */
export function DetailSectionActions({ children }: { children: React.ReactNode }) {
  const { actionsSlot } = React.useContext(SectionChromeContext)
  return actionsSlot ? createPortal(children, actionsSlot) : null
}

export interface DetailViewSectionsProps extends DetailViewMainTabsProps {
  /**
   * Drill panels a consumer (e.g. the work_order Schedule sections component)
   * pushes over the root page via the shared `panel`/`item` nuqs query params —
   * same drill mechanism as `agent-detail-tabs.tsx`'s `procedure`/`drill` params,
   * generalized so this file stays entity-agnostic.
   */
  drillPanels?: RecordDrillPanel[]
}

/**
 * DetailViewSections — `layout: 'sections'` main area (dispatch M2 build spec §F.1,
 * 04-ui.md §6). Renders the registered mainTab components as stacked `<Section>`
 * blocks on ONE scrolling column with a scroll-spy tab strip, instead of
 * `DetailViewMainTabs`' content-swapping `TabsContent` panels. Structure mirrors
 * `agent-detail-tabs.tsx` verbatim: `NavStack` (root = the sectioned page, drill
 * panels pushed via nuqs) + `NavStackBar` (the scroll-spy `Tabs` strip) +
 * `NavStackPanels` + `useScrollSpy` bound to the existing `?tab=` query state.
 */
export function DetailViewSections({
  recordId,
  entityType,
  config,
  activeTab,
  onTabChange,
  record,
  drillPanels = [],
}: DetailViewSectionsProps) {
  const { entityInstanceId } = parseRecordId(recordId)

  // Generic two-level drill protocol shared across every `layout: 'sections'`
  // consumer: `panel` selects a RecordDrillPanel, `item` (optional) drills one
  // level further inside it. Stack derivation (incl. the skip-the-list
  // direct-entry rule) lives in `useRecordDrillStack`, shared with the drawer.
  const drill = useRecordDrillStack(drillPanels)

  const sectionKeys = React.useMemo(() => config.mainTabs.map((t) => t.value), [config.mainTabs])

  // Re-bind the scroll listener after the root ScrollArea remounts (NavStackPanels
  // only mounts the top panel — returning from a drill recreates the viewport node).
  const { scrollContainerRef, assignRef, scrollToSection } = useScrollSpy<string>({
    sections: sectionKeys,
    active: activeTab,
    onActiveChange: onTabChange,
    remountKey: `${drill.panel}:${drill.item}`,
    spyBuffer: SPY_BUFFER,
    scrollBuffer: SCROLL_BUFFER,
  })

  const handleTabChange = React.useCallback(
    (value: string) => {
      // The tab strip is only the root panel's bar, so this fires at root — clearing
      // the drill params is defensive. Scroll the chosen section into view.
      drill.clear()
      onTabChange(value)
      scrollToSection(value)
    },
    [onTabChange, drill.clear, scrollToSection]
  )

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

  return (
    <NavStack
      stack={drill.stack}
      onStackChange={drill.onStackChange}
      className='flex flex-col flex-1 min-h-0 h-full'>
      <NavStackBar className='shrink-0 border-b bg-primary-150' />
      <NavStackPanels className='flex-1 min-h-0'>
        <NavStackPanel
          value='root'
          className='h-full bg-neutral-100 dark:bg-background'
          bar={
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList
                className='w-full justify-start rounded-none bg-transparent px-2'
                variant='outline'>
                {config.mainTabs.map((tab) => {
                  const Icon = getIconComponent(tab.icon)
                  return (
                    <TabsTrigger key={tab.value} value={tab.value} variant='outline'>
                      <Icon className='size-3.5 mr-1.5 opacity-70' />
                      {tab.label}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          }>
          <ScrollArea
            viewportRef={scrollContainerRef}
            className='h-full'
            scrollbarClassName='w-1.5 z-20'
            noFade>
            {config.mainTabs.map((tab) => {
              const Icon = getIconComponent(tab.icon)
              return (
                <div key={tab.value} ref={assignRef(tab.value)}>
                  <ChromedSection
                    label={tab.label}
                    icon={<Icon className='size-4' />}
                    fullBleed={tab.fullBleed}>
                    <LazySectionTabComponent
                      entityType={entityType}
                      tabValue={tab.value}
                      entityInstanceId={entityInstanceId}
                      recordId={recordId}
                      record={record}
                    />
                  </ChromedSection>
                </div>
              )
            })}

            {/* Spacer so the last section can scroll up to the activation line. */}
            <div className='h-[40vh]' />
          </ScrollArea>
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
 * A `<Section>` whose header carries two portal slots — one after the title, one
 * in the actions area — exposed to the section's body via `SectionChromeContext`
 * so tab components can inject a badge / header actions through
 * `DetailSectionTitleExtra` / `DetailSectionActions`.
 *
 * Sections stay simultaneously visible (scroll-spy over a single page, not an
 * accordion) — same choice as agent-detail-tabs.tsx, which passes
 * collapsible={false} on every one of its sections. It also sidesteps the one
 * genuinely fiddly bit here: a collapsed Section would hide QuoteLineItemsTab's
 * own header action strip (send/download/lifecycle buttons, §G) along with its
 * body.
 */
function ChromedSection({
  label,
  icon,
  fullBleed = false,
  children,
}: {
  label: string
  icon: React.ReactNode
  /** Cancel the Section's horizontal inset so the body spans edge-to-edge (e.g. a line-items table). */
  fullBleed?: boolean
  children: React.ReactNode
}) {
  const [titleSlot, setTitleSlot] = React.useState<HTMLElement | null>(null)
  const [actionsSlot, setActionsSlot] = React.useState<HTMLElement | null>(null)
  const slots = React.useMemo(() => ({ titleSlot, actionsSlot }), [titleSlot, actionsSlot])

  return (
    <SectionChromeContext.Provider value={slots}>
      <Section
        title={
          <span className='inline-flex items-center gap-1.5'>
            {label}
            {/* normal-case: the section-title wrapper uppercases text */}
            <span ref={setTitleSlot} className='inline-flex items-center gap-1.5 normal-case' />
          </span>
        }
        icon={icon}
        actions={<span ref={setActionsSlot} className='flex items-center gap-1.5 empty:hidden' />}
        collapsible={false}
        initialOpen
        className={
          fullBleed ? '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3' : undefined
        }>
        {children}
      </Section>
    </SectionChromeContext.Provider>
  )
}

/**
 * Lazy load and render a tab component from the shared registry for `layout:
 * 'sections'` — the `DetailViewMainTabs`-side `LazyTabComponent` twin, differing
 * only in the `variant='section'` prop and NOT wrapping the loading/not-found
 * fallback in a full-height `ScrollArea` (the outer `ScrollArea` in
 * `DetailViewSections` already owns scrolling; this renders at intrinsic height).
 */
function LazySectionTabComponent({
  entityType,
  tabValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  tabValue: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const componentLoader = getDetailViewTabComponent(entityType, tabValue)
  const [Component, setComponent] = React.useState<React.ComponentType<DetailViewTabProps> | null>(
    null
  )
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    if (!componentLoader) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    componentLoader()
      .then((mod) => {
        setComponent(() => mod.default)
        setIsLoading(false)
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [componentLoader])

  if (isLoading) {
    return <div className='p-6 text-sm text-muted-foreground'>Loading...</div>
  }

  if (!Component) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>
        Tab component not found for {entityType}:{tabValue}
      </div>
    )
  }

  return (
    <Component
      entityInstanceId={entityInstanceId}
      recordId={recordId}
      record={record}
      variant='section'
    />
  )
}
