// apps/web/src/components/manufacturing/ui/settings/costing-settings-page.tsx
'use client'

// Parts > Settings > Costing (money 52-parts-costing-page.md §2.1).
//
// Two tabs, the active one in `useQueryState('s')`, modelled on the sibling
// `tariffs-settings-page.tsx`:
//
//   ?s=standard  the org-wide standard-cost roll (§2.2)
//   ?s=opening   the opening-stock checklist and its run (§2.3)
//
// 🛑 THE ORDER IS THE DESIGN, which is why the two live on one page and why
// `standard` is the default tab. Revaluation is `(new standard - old) x qty on
// hand`, so on an org with no opening balances every roll delta is zero no
// matter how large the price move (§1.4). The moment opening stock exists,
// every later roll revalues on-hand inventory to 5090. Rolling BEFORE opening
// stock is the last free correction anybody gets, and putting the roll behind
// the second tab would invite the opposite order.
//
// 🛑 THE GATE IS THE RECORD CAPABILITY, not `settingsManage` - the same call
// `tariffs-settings-page.tsx` and `tags-list.tsx` made, for the same reason.
// Both tabs write through `assertEditEntity(part def)` /
// `assertEditEntity(stock_movement def)`, which the routers already assert
// (`purchasing.ts:498`). Gating on settings would show the page to an actor the
// mutation then refuses on save. The sibling Parts > General page makes the
// OPPOSITE call, correctly: it edits org settings and nothing else.
//
// ⚠️ The page gate asks about the `part` def alone. The opening tab asks
// separately about `stock_movement`, because the two definitions carry their own
// per-def grants and an affordance refused on click is worse than one that is
// absent.

import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { Boxes, Calculator } from 'lucide-react'
import { useQueryState } from 'nuqs'
import SettingsPage from '~/components/global/settings-page'
import { useResourceProperty } from '~/components/resources'
import { useRequireEntityEdit } from '~/providers/capabilities-provider'
import { OpeningStockTab } from './opening-stock-tab'
import { StandardCostSection } from './standard-cost-section'

const BREADCRUMBS = [
  { title: 'Parts', href: '/app/parts' },
  { title: 'Settings' },
  { title: 'Costing' },
]

const PAGE_DESCRIPTION =
  'What a part is valued at, and what was on the shelf on day one. Roll the standard first: a revaluation is the change in standard times the quantity on hand, so it costs nothing until stock exists, and it is never free again afterwards.'

const TABS = [
  { value: 'standard', label: 'Standard cost', icon: Calculator },
  { value: 'opening', label: 'Opening stock', icon: Boxes },
]

type CostingTab = 'standard' | 'opening'

export function CostingSettingsPage() {
  const [tab, setTab] = useQueryState('s', { defaultValue: 'standard' as string })
  const activeTab: CostingTab = tab === 'opening' ? 'opening' : 'standard'

  // The client mirror of what the server will actually do. An unresolved def id
  // is NOT KNOWN rather than denied - the resource store hydrates
  // asynchronously, and redirecting on the pre-hydration render would eject a
  // legitimate admin on every refresh.
  const partDefId = useResourceProperty('part', 'id')
  useRequireEntityEdit(partDefId)

  return (
    <SettingsPage
      title='Costing'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(next) => void setTab(next)}
          size='sm'
          items={TABS}
        />
      }>
      {activeTab === 'standard' ? (
        <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
          <StandardCostSection />
        </div>
      ) : (
        <OpeningStockTab />
      )}
    </SettingsPage>
  )
}
