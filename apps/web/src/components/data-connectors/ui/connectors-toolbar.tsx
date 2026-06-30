// apps/web/src/components/data-connectors/ui/connectors-toolbar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { useBulkMode, useListSelection } from '~/components/list-selection'

interface ConnectorsToolbarProps {
  search: string
  onSearchChange: (value: string) => void
}

/** Connectors list toolbar — name search + the bulk-select toggle. */
export function ConnectorsToolbar({ search, onSearchChange }: ConnectorsToolbarProps) {
  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)

  return (
    <ListToolbar>
      <InputSearch
        value={search}
        placeholder='Search connectors...'
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <ListToolbarGroup align='end'>
        <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />
      </ListToolbarGroup>
    </ListToolbar>
  )
}
