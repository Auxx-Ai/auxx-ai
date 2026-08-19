// packages/lib/src/workflows/__tests__/default-workflow-identity.test.ts

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKFLOW_ICON_IDS,
  nextUntitledWorkflowName,
  pickDefaultWorkflowIcon,
  UNTITLED_WORKFLOW_NAME,
} from '../default-workflow-identity'

describe('nextUntitledWorkflowName', () => {
  it('uses the bare base name in an empty organization', () => {
    expect(nextUntitledWorkflowName([])).toBe(UNTITLED_WORKFLOW_NAME)
  })

  it('ignores workflows the user named themselves', () => {
    expect(nextUntitledWorkflowName(['Order sync', 'Refund bot'])).toBe(UNTITLED_WORKFLOW_NAME)
  })

  it('numbers from 1 once the bare name is taken', () => {
    expect(nextUntitledWorkflowName([UNTITLED_WORKFLOW_NAME])).toBe('Untitled workflow 1')
  })

  it('climbs past the highest number in use rather than reusing a deleted one', () => {
    // Gap-filling would hand a fresh workflow the name of one the user just
    // deleted, which reads as a resurrection in the list.
    expect(nextUntitledWorkflowName([UNTITLED_WORKFLOW_NAME, 'Untitled workflow 3'])).toBe(
      'Untitled workflow 4'
    )
  })

  it('walks a run of creates without ever repeating a name', () => {
    const taken: string[] = []
    for (let i = 0; i < 6; i++) taken.push(nextUntitledWorkflowName(taken))
    expect(new Set(taken).size).toBe(taken.length)
  })
})

describe('pickDefaultWorkflowIcon', () => {
  it('cycles the colour so consecutive workflows never share one', () => {
    const colors = [0, 1, 2, 3].map((count) => pickDefaultWorkflowIcon(count).color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('wraps the colour cycle instead of running off the end', () => {
    // The 11-colour palette must stay indexable at any org size.
    expect(pickDefaultWorkflowIcon(0).color).toBe(pickDefaultWorkflowIcon(11).color)
    expect(pickDefaultWorkflowIcon(999).color).toBeTruthy()
  })

  it('only ever picks from the curated icon pool', () => {
    // A glyph outside the pool would mean a UI-chrome icon (x, menu) landing on
    // a workflow tile, or an id `getIcon` cannot resolve at all.
    const pool = new Set<string>(DEFAULT_WORKFLOW_ICON_IDS)
    const seen = new Set(Array.from({ length: 200 }, (_, i) => pickDefaultWorkflowIcon(i).iconId))
    expect(seen.size).toBeGreaterThan(1)
    for (const iconId of seen) expect(pool.has(iconId)).toBe(true)
  })

  it('carries no duplicate icon ids, so the pool is as wide as it looks', () => {
    expect(new Set(DEFAULT_WORKFLOW_ICON_IDS).size).toBe(DEFAULT_WORKFLOW_ICON_IDS.length)
  })
})
