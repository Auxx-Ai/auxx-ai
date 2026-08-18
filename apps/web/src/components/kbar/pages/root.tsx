// apps/web/src/components/kbar/pages/root.tsx
'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { useMemo, useState } from 'react'
import { useContextualSections } from '../contextual/select-contextual'
import { PaletteActionItem } from '../palette-action-item'
import { useRecentsStore } from '../recents-store'
import { createPaletteFilter } from '../score'
import { selectOnEnter } from '../select-on-enter'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction, PaletteSection } from '../types'

/** Page-scoped rows take a small edge so they win ties in the flat search list. */
const CONTEXTUAL_BOOST = 1.05

/** One row in the flat (searching) list. */
interface FlatEntry {
  action: PaletteAction
  boost?: number
  /** Contextual rows are excluded from recents — their ids are page-ephemeral. */
  recordRecent: boolean
}

/**
 * Root page: a single-column, client-filtered action list (cmdk). The first row
 * is "Search records", which drills into the record-search page; everything else
 * is grouped by section (Actions, Navigation, Create, Settings, Theme). On an
 * empty query a "Recent" group surfaces the last-run actions.
 *
 * **Sections only survive an empty query.** cmdk cannot reorder groups — its
 * `sort()` looks a group up by its internal id against a `data-value` that holds
 * the *heading*, so the selector never matches and groups keep their declared
 * order no matter how their members score. Item sorting *inside* a group does
 * work, so as soon as there is a query every row is rendered into one unheaded
 * group and ranking becomes global. Scoring is ours — see {@link createPaletteFilter}.
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
  const searching = query.trim() !== ''
  const showRecents = !searching && recentActions.length > 0

  const searchActions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'search-records',
        label: 'Search records',
        subtitle: 'Find contacts, companies, tickets, parts…',
        icon: 'search',
        keywords: 'search records find lookup',
        perform: () => goTo('search'),
      },
      {
        id: 'search-threads',
        label: 'Search threads',
        subtitle: 'Read mail across every inbox',
        icon: 'mail',
        keywords: 'search threads mail email read inbox conversation',
        perform: () => goTo('search-threads'),
      },
    ],
    [goTo]
  )

  // Every row the palette can show, de-duped by id (cmdk requires unique values).
  const flat = useMemo<FlatEntry[]>(() => {
    const entries: FlatEntry[] = [
      ...contextualSections.flatMap((section) =>
        section.actions.map((action) => ({ action, boost: CONTEXTUAL_BOOST, recordRecent: false }))
      ),
      ...searchActions.map((action) => ({ action, recordRecent: false })),
      ...sections.flatMap((section) =>
        section.actions.map((action) => ({ action, recordRecent: true }))
      ),
    ]
    const seen = new Set<string>()
    return entries.filter((entry) => {
      if (seen.has(entry.action.id)) return false
      seen.add(entry.action.id)
      return true
    })
  }, [contextualSections, searchActions, sections])

  const filter = useMemo(() => createPaletteFilter(flat), [flat])

  return (
    <Command loop filter={filter} onKeyDown={selectOnEnter} className='min-h-0'>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        autoFocus
        placeholder='Type a command or search…'
      />
      <CommandList scrollAreaClassName='max-h-[min(420px,60vh)] max-sm:min-h-0 max-sm:flex-1 max-sm:max-h-none'>
        <CommandEmpty>No results found.</CommandEmpty>

        {searching ? (
          // One group → one sort container → global ranking.
          <CommandGroup>
            {flat.map((entry) => (
              <PaletteActionItem
                key={entry.action.id}
                action={entry.action}
                onRun={entry.recordRecent ? onRun : undefined}
              />
            ))}
          </CommandGroup>
        ) : (
          <>
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
              {searchActions.map((action) => (
                <PaletteActionItem key={action.id} action={action} />
              ))}
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
          </>
        )}
      </CommandList>
    </Command>
  )
}
