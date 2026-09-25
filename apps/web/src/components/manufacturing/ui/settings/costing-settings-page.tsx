// apps/web/src/components/manufacturing/ui/settings/costing-settings-page.tsx
'use client'

// Parts > Manage > Set counts (money 52-parts-costing-page.md §2.3; 111 D21). The standard-cost
// roll lives on Parts > Manage > General.
//
// Gated on edit of the `part` def, not `settingsManage`: the count writes assert
// `assertEditEntity(part def)` (`purchasing.ts:498`). An unresolved def id is not known rather than
// denied, since the resource store hydrates asynchronously.

import { useMemo } from 'react'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { useResourceProperty } from '~/components/resources'
import { useRequireEntityEdit } from '~/providers/capabilities-provider'
import { OpeningStockTab } from './opening-stock-tab'

const PAGE_DESCRIPTION = 'What is on the shelf, counted per part'

export function CostingSettingsPage() {
  const partDefId = useResourceProperty('part', 'id')
  useRequireEntityEdit(partDefId)

  useRegisterModuleToolbar(
    useMemo(() => ({ left: <ToolbarTitle hint={PAGE_DESCRIPTION}>Set counts</ToolbarTitle> }), [])
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <OpeningStockTab />
    </div>
  )
}
