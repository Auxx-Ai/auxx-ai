// apps/web/src/components/kbar/pages/root.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { useState } from 'react'
import { PaletteActionItem } from '../palette-action-item'
import { useRecentsStore } from '../recents-store'
import { selectOnEnter } from '../select-on-enter'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction, PaletteSection } from '../types'

/**
 * Root page: a single-column, client-filtered action list (cmdk). The first row
 * is "Search records", which drills into the record-search page; everything else
 * is grouped by section (Actions, Navigation, Create, Settings, Theme). On an
 * empty query a "Recent" group surfaces the last-run actions.
 */
export function RootPage({
  sections,
  recentActions,
}: {
  sections: PaletteSection[]
  recentActions: PaletteAction[]
}) {
  const [query, setQuery] = useState('')
  const goTo = useCommandPaletteStore((s) => s.goTo)
  const pushRecent = useRecentsStore((s) => s.push)

  const onRun = (action: PaletteAction) => pushRecent(action.id)
  const showRecents = query.trim() === '' && recentActions.length > 0

  return (
    <Command loop onKeyDown={selectOnEnter}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        autoFocus
        placeholder='Type a command or search…'
      />
      <CommandList className='max-h-[min(420px,60vh)]'>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading='Search'>
          <PaletteActionItem
            action={{
              id: 'search-records',
              label: 'Search records',
              subtitle: 'Find contacts, companies, tickets, parts…',
              icon: 'search',
              keywords: 'search records find lookup',
              perform: () => goTo('search'),
            }}
          />
        </CommandGroup>

        {showRecents && (
          <CommandGroup heading='Recent'>
            {recentActions.map((action) => (
              // Prefix the value so it stays unique vs the same action in its
              // section group below (cmdk requires unique item values).
              <PaletteActionItem
                key={`recent:${action.id}`}
                action={{ ...action, id: `recent:${action.id}` }}
                onRun={() => onRun(action)}
              />
            ))}
          </CommandGroup>
        )}

        {sections.map((section) =>
          section.actions.length > 0 ? (
            <CommandGroup key={section.label} heading={section.label}>
              {section.actions.map((action) => (
                <PaletteActionItem key={action.id} action={action} onRun={onRun} />
              ))}
            </CommandGroup>
          ) : null
        )}
      </CommandList>
    </Command>
  )
}
