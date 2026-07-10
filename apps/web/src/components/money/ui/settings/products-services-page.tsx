// apps/web/src/components/money/ui/settings/products-services-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Lock, Package, Percent } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ProductEditor } from './product-editor'
import { ProductsList } from './products-list'
import { TaxRateEditor } from './tax-rate-editor'
import type { TaxRate } from './tax-rate-types'
import { TaxRatesList } from './tax-rates-list'

type SettingsTab = 'products' | 'tax-rates'

const TABS: { value: SettingsTab; label: string; icon: typeof Package }[] = [
  { value: 'products', label: 'Products & Services', icon: Package },
  { value: 'tax-rates', label: 'Tax rates', icon: Percent },
]

/**
 * Products & Services settings page (money MQ1 — locked design 01-ui #6/#7):
 * `SettingsPage` + `ResponsiveTabs` subHeader, `grid-cols-[1fr_420px]` body —
 * left column the active tab's list, right column a persistent editor pane
 * (docked ≥ lg, a floating `DockableDrawer` below it).
 */
export function ProductsServicesPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'products' as string })
  const activeTab = (tab === 'tax-rates' ? 'tax-rates' : 'products') as SettingsTab

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [selectedTaxRateId, setSelectedTaxRateId] = useState<string | null>(null)

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
  const breadcrumbs = [{ title: 'Dispatch Settings' }, { title: 'Products & Services' }]

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Products & Services'
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

  const selectedTaxRate = taxRates.find((r) => r.id === selectedTaxRateId) ?? null
  const selectedId = activeTab === 'products' ? selectedProductId : selectedTaxRateId
  const mobileDrawerOpen = !isDesktop && !!selectedId

  const editorContent =
    activeTab === 'products' ? (
      <ProductEditor selectedId={selectedProductId} />
    ) : (
      <TaxRateEditor
        taxRate={selectedTaxRate}
        onUpdate={(patch) => selectedTaxRate && handleUpdateTaxRate(selectedTaxRate.id, patch)}
        onSetDefault={() => selectedTaxRate && handleSetDefaultTaxRate(selectedTaxRate.id)}
      />
    )

  return (
    <SettingsPage
      title='Products & Services'
      description='Manage the catalog and tax rates used on quotes and invoices.'
      breadcrumbs={breadcrumbs}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(value) => setTab(value)}
          size='sm'
          items={TABS}
        />
      }>
      <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-w-0'>
          {activeTab === 'products' ? (
            <ProductsList
              selectedId={selectedProductId}
              onSelect={setSelectedProductId}
              currency={currency}
            />
          ) : (
            <TaxRatesList
              taxRates={taxRates}
              selectedId={selectedTaxRateId}
              onSelect={setSelectedTaxRateId}
              onAdd={handleAddTaxRate}
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
            setSelectedTaxRateId(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title={activeTab === 'products' ? 'Edit item' : 'Edit tax rate'}>
        {editorContent}
      </DockableDrawer>
    </SettingsPage>
  )
}
