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
import { useContextualSections } from '../contextual/select-contextual'
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

  // Page-defined contextual groups (from mounted <CommandContext>/<CommandAction>).
  // Lead the list, above the static "Search" group — page actions come first.
  const contextualSections = useContextualSections()

  const onRun = (action: PaletteAction) => pushRecent(action.id)
  const showRecents = query.trim() === '' && recentActions.length > 0

  return (
    <Command loop onKeyDown={selectOnEnter} className='min-h-0'>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        autoFocus
        placeholder='Type a command or search…'
      />
      <CommandList scrollAreaClassName='max-h-[min(420px,60vh)] max-sm:min-h-0 max-sm:flex-1 max-sm:max-h-none'>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Contextual groups — page-ephemeral, excluded from recents (unstable ids). */}
        {contextualSections.map((section) =>
          section.actions.length > 0 ? (
            <CommandGroup key={`ctx:${section.label}`} heading={section.label}>
              {section.actions.map((action) => (
                <PaletteActionItem key={action.id} action={action} />
              ))}
            </CommandGroup>
          ) : null
        )}

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
          <PaletteActionItem
            action={{
              id: 'search-threads',
              label: 'Search threads',
              subtitle: 'Read mail across every inbox',
              icon: 'mail',
              keywords: 'search threads mail email read inbox conversation',
              perform: () => goTo('search-threads'),
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
