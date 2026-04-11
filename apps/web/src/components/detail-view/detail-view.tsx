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
import { useState } from 'react'
import { toRecordId, useRecord, useResourceProperty } from '~/components/resources'
import { useIsMobile } from '~/hooks/use-mobile'
import { useDockStore } from '~/stores/dock-store'
import { DetailViewActions } from './components/detail-view-actions'
import { DetailViewMainTabs } from './detail-view-main-tabs'
import { DetailViewNotFound } from './detail-view-not-found'
import { DetailViewSidebar } from './detail-view-sidebar'
import { DetailViewSkeleton } from './detail-view-skeleton'
import type { DetailViewProps } from './types'

/**
 * DetailView - Universal full-page detail view component
 * Works for all entity types (system and custom) using registry-based configuration
 */
export function DetailView({ apiSlug, instanceId, backUrl: backUrlOverride }: DetailViewProps) {
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

  // Get record data
  const { record, isLoading, isNotFound } = useRecord({ recordId, enabled: true })

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
          : `/app/custom/${apiSlug}`

  const backUrl = backUrlOverride ?? defaultBackUrl

  // Loading state
  if (isLoading) {
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
          <MainPageBreadcrumbItem title={displayName} last />
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
        <DetailViewMainTabs
          recordId={recordId}
          entityType={entityType}
          config={config}
          activeTab={mainTab ?? config.defaultTab ?? 'overview'}
          onTabChange={setMainTab}
          record={record}
        />
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
