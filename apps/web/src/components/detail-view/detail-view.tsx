// apps/web/src/components/detail-view/detail-view.tsx
'use client'

import { getDetailViewConfig, type ModelType } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Drawer, DrawerContent, DrawerHandle, DrawerTitle } from '@auxx/ui/components/drawer'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { PanelRight } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo, useState } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { getRecordDrillPanels } from '~/components/records/record-drill-panels'
import {
  toRecordId,
  useCanViewRecordResource,
  useRecord,
  useResource,
  useResourceProperty,
} from '~/components/resources'
import { useIsMobile } from '~/hooks/use-mobile'
import { useAccess } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { DetailViewActions } from './components/detail-view-actions'
import { DetailViewMainTabs } from './detail-view-main-tabs'
import { DetailViewNotFound } from './detail-view-not-found'
import { DetailViewSections } from './detail-view-sections'
import { DetailViewSidebar } from './detail-view-sidebar'
import { DetailViewSkeleton } from './detail-view-skeleton'
import type { DetailViewProps } from './types'

/**
 * DetailView - Universal full-page detail view component
 * Works for all entity types (system and custom) using registry-based configuration
 */
export function DetailView({ apiSlug, instanceId, backUrl: backUrlOverride }: DetailViewProps) {
  const { resource, isLoading: resourceLoading } = useResource(apiSlug)
  const { can, hasDefPresence } = useAccess()
  const canViewRecordResource = useCanViewRecordResource()

  // Get resource properties including id (entityDefinitionId) and entityType
  const resourceProps = useResourceProperty(apiSlug, [
    'id', // entityDefinitionId
    'entityType', // ModelType: 'contact' | 'ticket' | 'part' | 'entity' | etc.
    'label',
    'plural',
    'icon',
    'color',
  ])

  // Extract with defaults
  const entityDefinitionId = resourceProps?.id ?? apiSlug
  const entityType: ModelType = (resourceProps?.entityType as ModelType) ?? 'entity'
  const { label, plural, icon, color } = resourceProps ?? {}

  // Build recordId with the actual entityDefinitionId
  const recordId = toRecordId(entityDefinitionId, instanceId)
  // Presence, not def-view (plan v3/03 §6.1): a shared record must be openable
  // on its own detail page. The record READ itself is still scoped server-side —
  // `record.getById` returns `null` (→ 404) for a row this member cannot see, so
  // presence opens the route without opening the row.
  const canViewDefinition = resource
    ? hasDefPresence(resource.entityDefinitionId)
    : !resourceLoading

  // Get record data
  const { record, isLoading, isNotFound, hasLoadedOnce } = useRecord({
    recordId,
    enabled: !resourceLoading && canViewDefinition,
  })

  // Get config from registry based on entityType
  const config = getDetailViewConfig(entityType)

  // Tab state
  const [mainTab, setMainTab] = useQueryState('tab', {
    defaultValue: config.defaultTab ?? 'overview',
  })
  const [sidebarTab, setSidebarTab] = useState(config.defaultSidebarTab ?? 'overview')

  // Mobile detection
  const isMobile = useIsMobile()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Dock state for resizable sidebar
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Determine back URL based on entity type
  const defaultBackUrl =
    entityType === 'contact'
      ? '/app/contacts'
      : entityType === 'ticket'
        ? '/app/tickets'
        : entityType === 'part'
          ? '/app/parts'
          : entityType === 'company'
            ? '/app/companies'
            : entityType === 'meeting'
              ? '/app/calls'
              : `/app/custom/${apiSlug}`

  const backUrl = backUrlOverride ?? defaultBackUrl

  // Filter once at the detail-view boundary so the tab strip, rendered
  // sections, active-tab fallback, and lazy query owners all consume the same
  // list. This also handles a hidden default or a denied `?tab=` deep link.
  const visibleMainTabs = useMemo(
    () =>
      config.mainTabs
        .filter((tab) => !tab.permissionKey || can(tab.permissionKey))
        // Layer-3 per-definition gate for tabs that list another definition's
        // records (contact → Tickets, part → Subparts/Vendors). Load-bearing on
        // this surface specifically: `tickets` is the contact page's DEFAULT tab,
        // so without it a `tickets: None` member lands on it.
        .filter((tab) => canViewRecordResource(tab.recordResource)),
    [config.mainTabs, can, canViewRecordResource]
  )
  const requestedMainTab = mainTab ?? config.defaultTab ?? 'overview'
  const activeMainTab = visibleMainTabs.some((tab) => tab.value === requestedMainTab)
    ? requestedMainTab
    : (visibleMainTabs[0]?.value ?? requestedMainTab)
  const visibleConfig = useMemo(
    () => ({ ...config, mainTabs: visibleMainTabs, defaultTab: activeMainTab }),
    [config, visibleMainTabs, activeMainTab]
  )
  const visibleDrillPanels = useMemo(
    () =>
      getRecordDrillPanels(entityType).filter(
        (panel) => !panel.permissionKey || can(panel.permissionKey)
      ),
    [entityType, can]
  )

  useEffect(() => {
    if (mainTab !== activeMainTab) void setMainTab(activeMainTab)
  }, [activeMainTab, mainTab, setMainTab])

  // Loading state — on first load the recordId is built with the apiSlug
  // fallback until `resource.list` hydrates, so "no record yet" (no fetch
  // attempt completed for the current id) must show the skeleton, not the
  // not-found screen.
  if (resourceLoading) {
    return <DetailViewSkeleton label={label} backUrl={backUrl} />
  }

  if (!canViewDefinition) {
    return <NoAccess area={plural ?? label} backHref={backUrl} />
  }

  if (isLoading || (!record && !hasLoadedOnce)) {
    return <DetailViewSkeleton label={label} backUrl={backUrl} />
  }

  // Not found state
  if (isNotFound || !record) {
    return <DetailViewNotFound label={label} backUrl={backUrl} />
  }

  const displayName = (record.displayName as string) || (record.name as string) || 'Untitled'

  const sidebarContent = (
    <DetailViewSidebar
      recordId={recordId}
      record={record}
      config={config}
      activeTab={sidebarTab}
      onTabChange={setSidebarTab}
      icon={icon}
      color={color}
      displayName={displayName}
    />
  )

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex gap-2'>
            {isMobile && (
              <Button variant='outline' size='sm' onClick={() => setMobileSidebarOpen(true)}>
                <PanelRight />
              </Button>
            )}
            <DetailViewActions
              entityType={entityType}
              recordId={recordId}
              record={record}
              config={config}
            />
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={plural ?? label ?? 'Records'} href={backUrl} />
          <MainPageBreadcrumbItem title={displayName} />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent
        dockedPanels={
          isMobile
            ? []
            : [
                {
                  key: 'sidebar',
                  content: sidebarContent,
                  width: dockedWidth,
                  onWidthChange: setDockedWidth,
                  minWidth,
                  maxWidth,
                },
              ]
        }>
        {config.layout === 'sections' ? (
          <DetailViewSections
            recordId={recordId}
            entityType={entityType}
            config={visibleConfig}
            activeTab={activeMainTab}
            onTabChange={setMainTab}
            record={record}
            drillPanels={visibleDrillPanels}
          />
        ) : (
          <DetailViewMainTabs
            recordId={recordId}
            entityType={entityType}
            config={visibleConfig}
            activeTab={activeMainTab}
            onTabChange={setMainTab}
            record={record}
          />
        )}
      </MainPageContent>

      {/* Mobile sidebar drawer */}
      {isMobile && (
        <Drawer
          direction='right'
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          defaultWidth={dockedWidth}
          minWidth={minWidth}
          maxWidth={maxWidth}>
          <DrawerContent>
            <DrawerHandle />
            <DrawerTitle className='sr-only'>{displayName}</DrawerTitle>
            {sidebarContent}
          </DrawerContent>
        </Drawer>
      )}
    </MainPage>
  )
}
