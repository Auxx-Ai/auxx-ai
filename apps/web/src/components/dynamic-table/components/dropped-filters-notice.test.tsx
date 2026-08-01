// apps/web/src/components/dynamic-table/components/dropped-filters-notice.test.tsx
//
// The notice is the only place a user ever learns that the list they are looking
// at is WIDER than the filters they set. Two properties are worth pinning:
//
//   1. It is silent on a clean list. Every records table and the KB articles
//      table mount this on every render; a false positive would be worse than
//      the silence it replaces.
//   2. The count it renders is the UNCAPPED one. The array is server-capped, so
//      counting the array would make the warning itself understate the problem —
//      the exact failure mode this whole change exists to end.

import type { DroppedFilterNotice } from '@auxx/lib/resources/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { DroppedFiltersNotice } from './dropped-filters-notice'

const notice = (n: number): DroppedFilterNotice => ({
  conditionId: `cond_${n}`,
  fieldRef: `article:cf_${n}`,
  operator: 'equals',
  reason: 'unresolved-field-or-operator',
})

/** `TooltipProvider` mirrors the app shell (`global/auxx-app-providers.tsx`). */
const renderInShell = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe('DroppedFiltersNotice', () => {
  it('renders nothing when no filter was dropped', () => {
    const { container } = renderInShell(
      <DroppedFiltersNotice droppedConditions={[]} droppedConditionCount={0} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names one dropped filter in the singular', () => {
    renderInShell(
      <DroppedFiltersNotice droppedConditions={[notice(1)]} droppedConditionCount={1} />
    )
    expect(screen.getByText('1 filter was ignored')).toBeInTheDocument()
  })

  it('reports the UNCAPPED count, not the length of the capped array', () => {
    // 25 delivered, 40 dropped. Rendering "25" would be the same class of quiet
    // undercount the notice exists to surface.
    const delivered = Array.from({ length: 25 }, (_, i) => notice(i))
    renderInShell(<DroppedFiltersNotice droppedConditions={delivered} droppedConditionCount={40} />)
    expect(screen.getByText('40 filters were ignored')).toBeInTheDocument()
  })
})
