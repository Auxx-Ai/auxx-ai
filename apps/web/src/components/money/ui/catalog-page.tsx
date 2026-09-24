// apps/web/src/components/money/ui/catalog-page.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Boxes, Lock, Percent } from 'lucide-react'
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
import { TaxRateEditor } from './settings/tax-rate-editor'
import type { TaxRate } from './settings/tax-rate-types'
import { TaxRatesList } from './settings/tax-rates-list'

type CatalogTab = 'groups' | 'tax-rates'

const TABS: { value: CatalogTab; label: string; icon: typeof Boxes }[] = [
  { value: 'groups', label: 'Groups', icon: Boxes },
  { value: 'tax-rates', label: 'Tax rates', icon: Percent },
]

/**
 * Pricing at `/app/catalog`: catalog groups and tax rates (107 D9). What you sell
 * lives on Parts & Services; one phantom group draft, dropped when left untouched.
 */
export function CatalogPage() {
  useRequireCapability(PermissionKey.settingsManage)
  const { hasAccess } = useFeatureFlags()

  // `tax-rates` is the value the old settings route used, so the deep links
  // that carried `?s=tax-rates` there keep landing on this tab.
  const [tab, setTab] = useQueryState('s', { defaultValue: 'groups' as string })
  const activeTab: CatalogTab = tab === 'tax-rates' ? 'tax-rates' : 'groups'

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedTaxRateId, setSelectedTaxRateId] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState<CatalogDraftHandle | null>(null)

  function handleSelectGroup(id: string | null) {
    if (groupDraft && id !== groupDraft.draftId && id !== groupDraft.recordId) {
      setGroupDraft(null)
    }
    setSelectedGroupId(id)
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
  function handleGroupDraftNameChange(name: string) {
    setGroupDraft((prev) => (prev ? { ...prev, name } : prev))
  }
  // First create resolved: swap selection to the real id but KEEP the draft so
  // the editor form stays mounted (mid-typing text + pending debounced commit).
  function handleGroupDraftCommitted(recordId: string) {
    setGroupDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedGroupId(recordId)
  }
  function handleTabChange(next: string) {
    setTab(next)
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
          title='Pricing Not Available'
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
  const selectedId = activeTab === 'groups' ? selectedGroupId : selectedTaxRateId

  const editorContent =
    activeTab === 'groups' ? (
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
          paneTitle={activeTab === 'groups' ? 'Edit group' : 'Edit tax rate'}
          paneOpen={!!selectedId}
          onPaneClose={() => {
            setSelectedGroupId(null)
            setSelectedTaxRateId(null)
            setGroupDraft(null)
          }}>
          {activeTab === 'groups' ? (
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
