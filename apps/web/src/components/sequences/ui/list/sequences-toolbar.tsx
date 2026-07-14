// apps/web/src/components/sequences/ui/list/sequences-toolbar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar } from '@auxx/ui/components/list-toolbar'

interface SequencesToolbarProps {
  search: string
  onSearchChange: (value: string) => void
}

/**
 * Sequences list toolbar — name search only. No bulk-select for v1 (no bulk
 * action exists yet beyond per-card delete, which lives in the card menu).
 */
export function SequencesToolbar({ search, onSearchChange }: SequencesToolbarProps) {
  return (
    <ListToolbar>
      <InputSearch
        value={search}
        placeholder='Search sequences...'
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </ListToolbar>
  )
}
