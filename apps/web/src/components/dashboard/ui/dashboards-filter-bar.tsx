// apps/web/src/components/dashboard/ui/dashboards-filter-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { useBulkMode, useListSelection } from '~/components/list-selection'
import { useDashboards } from './dashboards-provider'

export function DashboardsFilterBar() {
  const { searchQuery, setSearchQuery } = useDashboards()
  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)

  return (
    <ListToolbar>
      <InputSearch
        value={searchQuery}
        placeholder='Search dashboards...'
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <ListToolbarGroup align='end'>
        <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />
      </ListToolbarGroup>
    </ListToolbar>
  )
}
