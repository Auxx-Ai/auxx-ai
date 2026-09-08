// apps/web/src/components/money/ui/catalog-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Boxes, Lock, Package, Percent } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { CatalogDraftHandle } from './settings/catalog-draft-types'
import { GroupEditor } from './settings/group-editor'
import { GroupsList } from './settings/groups-list'
import { ProductEditor } from './settings/product-editor'
import { ProductsList } from './settings/products-list'
import { TaxRateEditor } from './settings/tax-rate-editor'
import type { TaxRate } from './settings/tax-rate-types'
import { TaxRatesList } from './settings/tax-rates-list'

type CatalogTab = 'items' | 'groups' | 'tax-rates'

const TABS: { value: CatalogTab; label: string; icon: typeof Package }[] = [
  { value: 'items', label: 'Catalog items', icon: Package },
  { value: 'groups', label: 'Catalog groups', icon: Boxes },
  { value: 'tax-rates', label: 'Tax rates', icon: Percent },
]

/**
 * Products and Services, the single home for the sellable catalog, at
 * `/app/catalog` (plans/products/01-product-family.md §6, surface promotion).
 *
 * This route is now the ONLY one. `/app/dispatch/settings/products` used to
 * render an identical copy of these same lists and editors plus the tax-rates
 * tab, so the two surfaces duplicated ~90 lines of draft/selection
 * orchestration and gave a merchant two places to look; that route is now a
 * redirect here (tab query preserved) and its dispatch-settings sidebar entry
 * is gone. Tax rates moved with it, they are an org setting
 * (`documents.taxRates`), but keeping them one tab away from the prices they
 * apply to beats keeping them beside a settings page that no longer exists.
 *
 * `catalog_item` and `catalog_group` stay `isVisible: false`, so the entity
 * sidebar never auto-links them, this route plus its deliberate sidebar entry
 * IS the promotion, not a visibility flip.
 *
 * One phantom draft per record tab (money 15-settings-phantom-editors.md phase
 * 2), dropped when untouched on selecting another row or switching tabs. Tax
 * rates have no draft: they are a settings array, committed on add.
 */
export function CatalogPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  // `tax-rates` is the value the old settings route used, so the deep links
  // that carried `?s=tax-rates` there keep landing on this tab.
  const [tab, setTab] = useQueryState('s', { defaultValue: 'items' as string })
  const activeTab: CatalogTab =
    tab === 'groups' ? 'groups' : tab === 'tax-rates' ? 'tax-rates' : 'items'

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedTaxRateId, setSelectedTaxRateId] = useState<string | null>(null)
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

  // `useSettings({ scope })` FILTERS reads to that scope (use-settings.tsx:44-54), currency
  // stayed GENERAL while taxRates moved to DOCUMENTS (money MQ2 §A.3), so two hook instances
  // are needed; each scope's `updateOrganizationSetting` still writes any key correctly
  // (the mutation isn't scope-gated), so either is fine to use for tax-rate writes.
  const { getSetting: getGeneralSetting } = useSettings({ scope: 'GENERAL' })
  const { getSetting: getDocumentsSetting, updateOrganizationSetting } = useSettings({
    scope: 'DOCUMENTS',
  })
  const currency = (getGeneralSetting('organization.currency') as string) || 'USD'
  const taxRates = (getDocumentsSetting('documents.taxRates') as TaxRate[] | null) ?? []

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <MainPageContent>
        <EmptyState
          icon={Lock}
          title='Products and Services Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </MainPageContent>
    )
  }

  function commitTaxRates(next: TaxRate[]) {
    updateOrganizationSetting('documents.taxRates', next)
  }

  function handleAddTaxRate() {
    const id = generateId('taxrate')
    const next: TaxRate[] = [
      ...taxRates,
      { id, name: 'New tax rate', rate: 0, isDefault: taxRates.length === 0 },
    ]
    commitTaxRates(next)
    setSelectedTaxRateId(id)
  }

  function handleUpdateTaxRate(id: string, patch: Partial<TaxRate>) {
    commitTaxRates(taxRates.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function handleSetDefaultTaxRate(id: string) {
    commitTaxRates(taxRates.map((r) => ({ ...r, isDefault: r.id === id })))
  }

  function handleDeleteTaxRate(id: string) {
    const removed = taxRates.find((r) => r.id === id)
    const next = taxRates.filter((r) => r.id !== id)
    // Deleting the default promotes the first remaining rate, one is always default.
    const first = next[0]
    if (removed?.isDefault && first && !next.some((r) => r.isDefault)) {
      next[0] = { ...first, isDefault: true }
    }
    commitTaxRates(next)
    if (selectedTaxRateId === id) setSelectedTaxRateId(null)
  }

  const selectedTaxRate = taxRates.find((r) => r.id === selectedTaxRateId) ?? null
  const selectedId =
    activeTab === 'items'
      ? selectedItemId
      : activeTab === 'groups'
        ? selectedGroupId
        : selectedTaxRateId

  const editorContent =
    activeTab === 'items' ? (
      <ProductEditor
        selectedId={selectedItemId}
        draft={itemDraft}
        onDraftNameChange={handleItemDraftNameChange}
        onDraftCommitted={handleItemDraftCommitted}
      />
    ) : activeTab === 'groups' ? (
      <GroupEditor
        selectedId={selectedGroupId}
        currency={currency}
        draft={groupDraft}
        onDraftNameChange={handleGroupDraftNameChange}
        onDraftCommitted={handleGroupDraftCommitted}
      />
    ) : (
      <TaxRateEditor
        taxRate={selectedTaxRate}
        onUpdate={(patch) => selectedTaxRate && handleUpdateTaxRate(selectedTaxRate.id, patch)}
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
        {/* `scroll='columns'`: there is no `SettingsPage` here, so no page-level
            scroll container for a sticky pane to travel in - each column scrolls
            on its own inside the fixed-height frame. */}
        <MasterDetailSplit
          id='money-catalog'
          scroll='columns'
          pane={editorContent}
          paneTitle={
            activeTab === 'items'
              ? 'Edit item'
              : activeTab === 'groups'
                ? 'Edit group'
                : 'Edit tax rate'
          }
          paneOpen={!!selectedId}
          onPaneClose={() => {
            setSelectedItemId(null)
            setSelectedGroupId(null)
            setSelectedTaxRateId(null)
            setItemDraft(null)
            setGroupDraft(null)
          }}>
          {activeTab === 'items' ? (
            <ProductsList
              selectedId={selectedItemId}
              onSelect={handleSelectItem}
              currency={currency}
              draft={itemDraft}
              onAddDraft={handleAddItemDraft}
            />
          ) : activeTab === 'groups' ? (
            <GroupsList
              selectedId={selectedGroupId}
              onSelect={handleSelectGroup}
              currency={currency}
              draft={groupDraft}
              onAddDraft={handleAddGroupDraft}
            />
          ) : (
            <TaxRatesList
              taxRates={taxRates}
              selectedId={selectedTaxRateId}
              onSelect={setSelectedTaxRateId}
              onAdd={handleAddTaxRate}
              onSetDefault={handleSetDefaultTaxRate}
              onDelete={handleDeleteTaxRate}
            />
          )}
        </MasterDetailSplit>
      </div>
    </MainPageContent>
  )
}
