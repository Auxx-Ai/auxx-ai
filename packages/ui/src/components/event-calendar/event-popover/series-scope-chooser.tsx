// packages/ui/src/components/event-calendar/event-popover/series-scope-chooser.tsx

'use client'

import * as React from 'react'
import { Button } from '../../button'
import { PanelCard } from '../../panel-card'
import type { EventSeriesConfig, SeriesScope } from './types'

interface SeriesScopeContextValue {
  /**
   * Gates a commit behind the series-scope chooser: non-members (or when no `series` config is
   * present) invoke `commit('this')` synchronously. Members stash `commit` and render the
   * inline chooser card; picking an option resolves it with that scope, Cancel drops it.
   */
  gate: (commit: (scope: SeriesScope) => void) => void
}

const SeriesScopeContext = React.createContext<SeriesScopeContextValue | null>(null)

/** Read inside `EventPopoverBody` (or any consumer-injected section within it) to gate a
 * commit through the series-scope chooser (decision #3). */
export function useSeriesScope(): SeriesScopeContextValue {
  const ctx = React.useContext(SeriesScopeContext)
  if (!ctx) {
    throw new Error('useSeriesScope must be used within <EventPopoverBody>')
  }
  return ctx
}

const defaultLabels = { this: 'This visit', following: 'This and following', all: 'All' }

interface SeriesScopeProviderProps {
  series?: EventSeriesConfig
  children: React.ReactNode
}

/** Mounted internally by `EventPopoverBody`. Renders the inline scope-chooser card pinned at
 * the bottom of the body while a commit is pending scope resolution. */
export function SeriesScopeProvider({ series, children }: SeriesScopeProviderProps) {
  const [pendingCommit, setPendingCommit] = React.useState<((scope: SeriesScope) => void) | null>(
    null
  )

  const gate = React.useCallback(
    (commit: (scope: SeriesScope) => void) => {
      if (!series?.isMember) {
        commit('this')
        return
      }
      // Wrap in a function so React's state setter doesn't treat `commit` as an updater fn.
      setPendingCommit(() => commit)
    },
    [series?.isMember]
  )

  const resolve = (scope: SeriesScope) => {
    pendingCommit?.(scope)
    setPendingCommit(null)
  }

  const labels = { ...defaultLabels, ...series?.labels }

  return (
    <SeriesScopeContext.Provider value={{ gate }}>
      {children}
      {pendingCommit && (
        <div className='p-2 pt-0'>
          <PanelCard className='space-y-2'>
            <div className='text-sm font-medium'>Apply to</div>
            <div className='flex flex-col gap-1.5'>
              <Button variant='outline' size='sm' onClick={() => resolve('this')}>
                {labels.this}
              </Button>
              <Button variant='outline' size='sm' onClick={() => resolve('following')}>
                {labels.following}
              </Button>
              {!series?.hideAll && (
                <Button variant='outline' size='sm' onClick={() => resolve('all')}>
                  {labels.all}
                </Button>
              )}
              <Button variant='ghost' size='sm' onClick={() => setPendingCommit(null)}>
                Cancel
              </Button>
            </div>
          </PanelCard>
        </div>
      )}
    </SeriesScopeContext.Provider>
  )
}
