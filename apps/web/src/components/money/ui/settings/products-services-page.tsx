// apps/web/src/components/money/ui/settings/products-services-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Boxes, Lock, Package, Percent } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { CatalogDraftHandle } from './catalog-draft-types'
import { GroupEditor } from './group-editor'
import { GroupsList } from './groups-list'
import { ProductEditor } from './product-editor'
import { ProductsList } from './products-list'
import { TaxRateEditor } from './tax-rate-editor'
import type { TaxRate } from './tax-rate-types'
import { TaxRatesList } from './tax-rates-list'

type SettingsTab = 'products' | 'groups' | 'tax-rates'

const TABS: { value: SettingsTab; label: string; icon: typeof Package }[] = [
  { value: 'products', label: 'Catalog items', icon: Package },
  { value: 'groups', label: 'Catalog groups', icon: Boxes },
  { value: 'tax-rates', label: 'Tax rates', icon: Percent },
]

/**
 * Products & Services settings page (money MQ1 — locked design 01-ui #6/#7):
 * `SettingsPage` + `ResponsiveTabs` subHeader, `grid-cols-[1fr_420px]` body —
 * left column the active tab's list, right column a persistent editor pane
 * (docked ≥ lg, a floating `DockableDrawer` below it).
 */
export function ProductsServicesPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'products' as string })
  const activeTab = (
    tab === 'tax-rates' ? 'tax-rates' : tab === 'groups' ? 'groups' : 'products'
  ) as SettingsTab

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedTaxRateId, setSelectedTaxRateId] = useState<string | null>(null)

  // Phantom drafts (money 15-settings-phantom-editors.md phase 2) — one per
  // tab. The full draft field set lives inside the editor component instance
  // (keyed by `draftId`); this page only tracks enough to render the list's
  // phantom row and to know whether the current selection is a draft. An
  // untouched draft is dropped silently on: selecting another row, adding a
  // new draft, or switching tabs — never on a mere re-render.
  const [productDraft, setProductDraft] = useState<CatalogDraftHandle | null>(null)
  const [groupDraft, setGroupDraft] = useState<CatalogDraftHandle | null>(null)

  function handleSelectProduct(id: string | null) {
    // Selecting anything other than the draft itself (or its committed record,
    // which keeps the draft form mounted — see CatalogDraftHandle.recordId)
    // drops the draft.
    if (productDraft && id !== productDraft.draftId && id !== productDraft.recordId) {
      setProductDraft(null)
    }
    setSelectedProductId(id)
  }
  function handleSelectGroup(id: string | null) {
    if (groupDraft && id !== groupDraft.draftId && id !== groupDraft.recordId) {
      setGroupDraft(null)
    }
    setSelectedGroupId(id)
  }
  function handleAddProductDraft() {
    if (productDraft && !productDraft.recordId) {
      setSelectedProductId(productDraft.draftId) // uncommitted one exists — just re-select it
      return
    }
    const draftId = generateId('draft')
    setProductDraft({ draftId, name: '' })
    setSelectedProductId(draftId)
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
  function handleProductDraftNameChange(name: string) {
    setProductDraft((prev) => (prev ? { ...prev, name } : prev))
  }
  function handleGroupDraftNameChange(name: string) {
    setGroupDraft((prev) => (prev ? { ...prev, name } : prev))
  }
  // First create resolved: swap selection to the real id but KEEP the draft —
  // the draft editor form must stay mounted so mid-typing text and the pending
  // debounced name commit survive (a remount would replace the input's text
  // with the create snapshot and cancel the debounce timer).
  function handleProductDraftCommitted(recordId: string) {
    setProductDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedProductId(recordId)
  }
  function handleGroupDraftCommitted(recordId: string) {
    setGroupDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedGroupId(recordId)
  }
  function handleTabChange(next: string) {
    setTab(next)
    // Untouched drafts don't survive a tab switch — the other tab's list no
    // longer renders the phantom row, so hanging onto it would be confusing.
    if (productDraft) setProductDraft(null)
    if (groupDraft) setGroupDraft(null)
  }

  // `useSettings({ scope })` FILTERS reads to that scope (use-settings.tsx:44-54) — currency
  // stayed GENERAL while taxRates moved to DOCUMENTS (money MQ2 §A.3), so two hook instances
  // are needed; each scope's `updateOrganizationSetting` still writes any key correctly
  // (the mutation isn't scope-gated), so either is fine to use for tax-rate writes.
  const { getSetting: getGeneralSetting } = useSettings({ scope: 'GENERAL' })
  const { getSetting: getDocumentsSetting, updateOrganizationSetting } = useSettings({
    scope: 'DOCUMENTS',
  })
  const currency = (getGeneralSetting('organization.currency') as string) || 'USD'
  const taxRates = (getDocumentsSetting('documents.taxRates') as TaxRate[] | null) ?? []

  const isDesktop = useMedia('(min-width: 1024px)')

  // No `/app/dispatch` module home yet (M2 brings it) — the trail stays local
  // to settings rather than linking a route that doesn't exist.
  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Catalog' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Catalog'
        description='Manage the catalog and tax rates used on quotes and invoices.'
        breadcrumbs={breadcrumbs}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
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
    // Deleting the default promotes the first remaining rate — one is always default.
    const first = next[0]
    if (removed?.isDefault && first && !next.some((r) => r.isDefault)) {
      next[0] = { ...first, isDefault: true }
    }
    commitTaxRates(next)
    if (selectedTaxRateId === id) setSelectedTaxRateId(null)
  }

  const selectedTaxRate = taxRates.find((r) => r.id === selectedTaxRateId) ?? null
  const selectedId =
    activeTab === 'products'
      ? selectedProductId
      : activeTab === 'groups'
        ? selectedGroupId
        : selectedTaxRateId
  const mobileDrawerOpen = !isDesktop && !!selectedId

  const editorContent =
    activeTab === 'products' ? (
      <ProductEditor
        selectedId={selectedProductId}
        draft={productDraft}
        onDraftNameChange={handleProductDraftNameChange}
        onDraftCommitted={handleProductDraftCommitted}
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
    <SettingsPage
      title='Catalog'
      description='Manage the catalog and tax rates used on quotes and invoices.'
      breadcrumbs={breadcrumbs}
      subHeader={
        <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} size='sm' items={TABS} />
      }>
      <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-w-0'>
          {activeTab === 'products' ? (
            <ProductsList
              selectedId={selectedProductId}
              onSelect={handleSelectProduct}
              currency={currency}
              draft={productDraft}
              onAddDraft={handleAddProductDraft}
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
        </div>
        <div className='hidden border-l lg:block'>{editorContent}</div>
      </div>

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProductId(null)
            setSelectedGroupId(null)
            setSelectedTaxRateId(null)
            setProductDraft(null)
            setGroupDraft(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title={
          activeTab === 'products'
            ? 'Edit item'
            : activeTab === 'groups'
              ? 'Edit group'
              : 'Edit tax rate'
        }>
        {editorContent}
      </DockableDrawer>
    </SettingsPage>
  )
}
