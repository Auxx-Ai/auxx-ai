// apps/web/src/components/money/ui/catalog-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Boxes, Lock, Package } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useMedia } from '~/hooks/use-media'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { CatalogDraftHandle } from './settings/catalog-draft-types'
import { GroupEditor } from './settings/group-editor'
import { GroupsList } from './settings/groups-list'
import { ProductEditor } from './settings/product-editor'
import { ProductsList } from './settings/products-list'

type CatalogTab = 'items' | 'groups'

const TABS: { value: CatalogTab; label: string; icon: typeof Package }[] = [
  { value: 'items', label: 'Catalog items', icon: Package },
  { value: 'groups', label: 'Catalog groups', icon: Boxes },
]

/**
 * First-class catalog surface at `/app/catalog`
 * (plans/products/01-product-family.md §6 — surface promotion).
 *
 * Hosts the SAME list/editor components as the dispatch settings tab at
 * `/app/dispatch/settings/products` — `ProductsList`/`ProductEditor` and
 * `GroupsList`/`GroupEditor` — inside the `/app/products` route shell instead
 * of the settings chrome. The settings tab keeps working unchanged (it also
 * owns tax rates, which stay a settings concern); `catalog_item` and
 * `catalog_group` stay `isVisible: false`, so this route plus its deliberate
 * sidebar entry IS the promotion — not a visibility flip.
 *
 * The selection/draft orchestration mirrors `settings/products-services-page.tsx`
 * (money 15-settings-phantom-editors.md phase 2): one phantom draft per tab,
 * dropped when untouched on selecting another row or switching tabs.
 */
export function CatalogPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'items' as string })
  const activeTab: CatalogTab = tab === 'groups' ? 'groups' : 'items'

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [itemDraft, setItemDraft] = useState<CatalogDraftHandle | null>(null)
  const [groupDraft, setGroupDraft] = useState<CatalogDraftHandle | null>(null)

  function handleSelectItem(id: string | null) {
    if (itemDraft && id !== itemDraft.draftId && id !== itemDraft.recordId) {
      setItemDraft(null)
    }
    setSelectedItemId(id)
  }
  function handleSelectGroup(id: string | null) {
    if (groupDraft && id !== groupDraft.draftId && id !== groupDraft.recordId) {
      setGroupDraft(null)
    }
    setSelectedGroupId(id)
  }
  function handleAddItemDraft() {
    if (itemDraft && !itemDraft.recordId) {
      setSelectedItemId(itemDraft.draftId)
      return
    }
    const draftId = generateId('draft')
    setItemDraft({ draftId, name: '' })
    setSelectedItemId(draftId)
  }
  function handleAddGroupDraft() {
    if (groupDraft && !groupDraft.recordId) {
      setSelectedGroupId(groupDraft.draftId)
      return
    }
    const draftId = generateId('draft')
    setGroupDraft({ draftId, name: '' })
    setSelectedGroupId(draftId)
  }
  function handleItemDraftNameChange(name: string) {
    setItemDraft((prev) => (prev ? { ...prev, name } : prev))
  }
  function handleGroupDraftNameChange(name: string) {
    setGroupDraft((prev) => (prev ? { ...prev, name } : prev))
  }
  // First create resolved: swap selection to the real id but KEEP the draft so
  // the editor form stays mounted (mid-typing text + pending debounced commit).
  function handleItemDraftCommitted(recordId: string) {
    setItemDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedItemId(recordId)
  }
  function handleGroupDraftCommitted(recordId: string) {
    setGroupDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedGroupId(recordId)
  }
  function handleTabChange(next: string) {
    setTab(next)
    if (itemDraft) setItemDraft(null)
    if (groupDraft) setGroupDraft(null)
  }

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currency = (getSetting('organization.currency') as string) || 'USD'

  const isDesktop = useMedia('(min-width: 1024px)')

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <MainPageContent>
        <EmptyState
          icon={Lock}
          title='Catalog Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </MainPageContent>
    )
  }

  const selectedId = activeTab === 'items' ? selectedItemId : selectedGroupId
  const mobileDrawerOpen = !isDesktop && !!selectedId

  const editorContent =
    activeTab === 'items' ? (
      <ProductEditor
        selectedId={selectedItemId}
        draft={itemDraft}
        onDraftNameChange={handleItemDraftNameChange}
        onDraftCommitted={handleItemDraftCommitted}
      />
    ) : (
      <GroupEditor
        selectedId={selectedGroupId}
        currency={currency}
        draft={groupDraft}
        onDraftNameChange={handleGroupDraftNameChange}
        onDraftCommitted={handleGroupDraftCommitted}
      />
    )

  return (
    <MainPageContent>
      <div className='flex h-full min-h-0 flex-1 flex-col'>
        <div className='border-b px-3 py-2.5'>
          <ResponsiveTabs
            value={activeTab}
            onValueChange={handleTabChange}
            size='sm'
            items={TABS}
          />
        </div>
        <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
          <div className='min-w-0 overflow-y-auto'>
            {activeTab === 'items' ? (
              <ProductsList
                selectedId={selectedItemId}
                onSelect={handleSelectItem}
                currency={currency}
                draft={itemDraft}
                onAddDraft={handleAddItemDraft}
              />
            ) : (
              <GroupsList
                selectedId={selectedGroupId}
                onSelect={handleSelectGroup}
                currency={currency}
                draft={groupDraft}
                onAddDraft={handleAddGroupDraft}
              />
            )}
          </div>
          <div className='hidden overflow-y-auto border-l lg:block'>{editorContent}</div>
        </div>
      </div>

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItemId(null)
            setSelectedGroupId(null)
            setItemDraft(null)
            setGroupDraft(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title={activeTab === 'items' ? 'Edit item' : 'Edit group'}>
        {editorContent}
      </DockableDrawer>
    </MainPageContent>
  )
}
