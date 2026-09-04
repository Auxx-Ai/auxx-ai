// apps/web/src/components/records/layout-editor/__tests__/plan-layout-save.test.ts
//
// §9.5's routing, i.e. which of the two mutations one Save actually calls.
//
// Getting this wrong is silent in both directions. Writing the org layer for an
// ordinary member 403s at the router; writing the personal layer for an admin's
// section move would store a structural change where only that one member sees
// it, and the drawer would look correct to the person who made it.

import { describe, expect, it } from 'vitest'
import { moveBlock, setTabHidden } from '../editor-actions'
import { seedEditorState } from '../editor-state'
import { diffEditorState, planLayoutSave } from '../layout-diff'
import { testRegistry } from '../test-fixtures'

const registry = testRegistry()
const plan = (state: ReturnType<typeof seedEditorState>, canAdministerDef: boolean) => {
  const deltas = diffEditorState({ registry, state })
  const baseline = diffEditorState({ registry, state: seedEditorState({ registry }) })
  return planLayoutSave({
    canAdministerDef,
    orgDirty: JSON.stringify(deltas.org) !== JSON.stringify(baseline.org),
    personalDirty: JSON.stringify(deltas.user) !== JSON.stringify(baseline.user),
    deltas,
  })
}

describe('planLayoutSave', () => {
  it('writes nothing at all for an untouched session', () => {
    expect(plan(seedEditorState({ registry }), true)).toEqual([])
  })

  it('sends a section move to the ORG mutation only', () => {
    const state = moveBlock(seedEditorState({ registry }), {
      blockId: 'card:customer',
      overId: 'group:billing',
    })
    const writes = plan(state, true)

    expect(writes.map((write) => write.scope)).toEqual(['org'])
    expect(writes[0]?.delta.blocks).toEqual({ 'card:customer': { tab: 'billing' } })
  })

  it('sends a tab hide to the PERSONAL mutation only, even for an admin', () => {
    const state = setTabHidden(seedEditorState({ registry }), 'billing', true)
    const writes = plan(state, true)

    expect(writes.map((write) => write.scope)).toEqual(['personal'])
    expect(writes[0]?.delta).toEqual({ tabs: { hidden: ['billing'] } })
  })

  it('writes both layers, org first, when both were touched', () => {
    const state = setTabHidden(
      moveBlock(seedEditorState({ registry }), {
        blockId: 'card:customer',
        overId: 'group:billing',
      }),
      'tasks',
      true
    )

    expect(plan(state, true).map((write) => write.scope)).toEqual(['org', 'personal'])
  })

  // The org-scope affordances are absent for a member who cannot write that
  // layer, so a non-empty org diff here can only come from a stale render.
  // Dropping it is the fail-closed answer, and the router asserts the same rule.
  it('never writes the org layer without def administration', () => {
    const state = moveBlock(seedEditorState({ registry }), {
      blockId: 'card:customer',
      overId: 'group:billing',
    })

    expect(plan(state, false)).toEqual([])
  })

  it('still writes a member’s own tab hiding without def administration', () => {
    const state = setTabHidden(seedEditorState({ registry }), 'billing', true)

    expect(plan(state, false).map((write) => write.scope)).toEqual(['personal'])
  })
})
