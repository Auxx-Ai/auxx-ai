// apps/web/src/components/manufacturing/ui/settings/costing-settings-page.tsx
'use client'

// Parts > Manage > Costing (money 52-parts-costing-page.md §2.1; shape: plans/mrp/07-ui-plan.md §4.8).
//
// Two tabs, the active one in `useQueryState('s')`, modelled on the sibling
// `tariffs-settings-page.tsx`:
//
//   ?s=standard  the org-wide standard-cost roll (§2.2)
//   ?s=opening   the Set counts checklist and its run (§2.3; 111 D21)
//
// 🛑 THE ORDER IS THE DESIGN, which is why the two live on one page and why
// `standard` is the default tab. Revaluation is `(new standard - old) x qty on
// hand`, so on an org with nothing counted every roll delta is zero no
// matter how large the price move (§1.4). The moment stock is counted,
// every later roll revalues on-hand inventory to 5090. Rolling BEFORE counting
// is the last free correction anybody gets, and putting the roll behind
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
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Boxes, Calculator } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { useResourceProperty } from '~/components/resources'
import { useRequireEntityEdit } from '~/providers/capabilities-provider'
import { OpeningStockTab } from './opening-stock-tab'
import { StandardCostSection } from './standard-cost-section'

const PAGE_DESCRIPTION = 'What a part is valued at, and what is on the shelf'

const TABS = [
  { value: 'standard', label: 'Standard cost', icon: Calculator },
  { value: 'opening', label: 'Set counts', icon: Boxes },
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

  // No `SelectAllCheckbox` shares this bar, so the tab strip may sit in row 1 (ui guide §12.1).
  useRegisterModuleToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ToolbarTitle hint={PAGE_DESCRIPTION}>Costing</ToolbarTitle>
            <Separator orientation='vertical' className='h-6' />
            <ResponsiveTabs
              value={activeTab}
              onValueChange={(next) => void setTab(next)}
              size='sm'
              items={TABS}
            />
          </>
        ),
      }),
      [activeTab, setTab]
    )
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {activeTab === 'standard' ? (
        <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
          <StandardCostSection />
        </ScrollArea>
      ) : (
        <OpeningStockTab />
      )}
    </div>
  )
}
