// apps/web/src/components/workflow/nodes/core/if-else/adapters/__tests__/condition-adapter.test.tsx

import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConditionProvider, useConditionActions } from '~/components/conditions'
import { NodeType } from '~/components/workflow/types/node-types'
import type { IfElseNodeData } from '../../types'
import { useIfElseConditionAdapter } from '../condition-adapter'

/**
 * `case_id` IS the branch handle — it is what `node.tsx` renders as `handleId`,
 * what an edge stores as `sourceHandle`, and what the engine returns as
 * `outputHandle`. Two cases sharing one handle is a state `validateIfElseConfig`
 * refuses with `blocksAuthoring: true`, in a field with no editor.
 *
 * Deriving the handle from array position made that state reachable purely
 * through the canvas: add, add, delete the first added, add again — the last add
 * lands at the index the deleted case vacated and re-mints its neighbour's
 * address.
 */

const seedData = (): IfElseNodeData => ({
  type: NodeType.IF_ELSE,
  cases: [{ case_id: 'true', logical_operator: 'and', conditions: [] }],
})

type Actions = ReturnType<typeof useConditionActions>

interface Harness {
  data: () => IfElseNodeData
  actions: () => Actions
}

function renderAdapterHarness(): Harness {
  let latestData: IfElseNodeData = seedData()
  let latestActions: Actions | null = null

  function Capture() {
    latestActions = useConditionActions()
    return null
  }

  function Host() {
    const [data, setData] = useState<IfElseNodeData>(seedData)
    latestData = data

    const { groups, onGroupsChange, config } = useIfElseConditionAdapter({
      nodeId: 'if-else-test',
      data,
      setInputs: setData,
      readOnly: false,
    })

    return (
      <ConditionProvider
        conditions={[]}
        groups={groups}
        config={config}
        onConditionsChange={() => {}}
        onGroupsChange={onGroupsChange}
        nodeId='if-else-test'
        getFieldDefinition={() => undefined}>
        <Capture />
      </ConditionProvider>
    )
  }

  render(<Host />)

  return {
    data: () => latestData,
    actions: () => {
      if (!latestActions) throw new Error('condition actions were never captured')
      return latestActions
    },
  }
}

describe('useIfElseConditionAdapter — case_id identity', () => {
  it('keeps every case_id distinct across add / add / delete / add', () => {
    const harness = renderAdapterHarness()

    act(() => harness.actions().addGroup?.())
    act(() => harness.actions().addGroup?.())

    expect(harness.data().cases).toHaveLength(3)

    // Delete the FIRST added case, leaving the second in place.
    const doomed = harness.data().cases[1]
    expect(doomed).toBeDefined()
    // `case_id` IS the group id now — the case has no other identifier.
    act(() => harness.actions().removeGroup?.(doomed!.case_id))

    expect(harness.data().cases).toHaveLength(2)

    // The add that used to re-mint the surviving case's handle.
    act(() => harness.actions().addGroup?.())

    const caseIds = harness.data().cases.map((c) => c.case_id)
    expect(caseIds).toHaveLength(3)
    expect(new Set(caseIds).size).toBe(caseIds.length)
  })

  it('never derives a case_id from array position', () => {
    const harness = renderAdapterHarness()

    act(() => harness.actions().addGroup?.())
    act(() => harness.actions().addGroup?.())

    const added = harness.data().cases.slice(1)
    for (const addedCase of added) {
      expect(addedCase.case_id).toBeTruthy()
      expect(addedCase.case_id).not.toMatch(/^case_\d+$/)
    }
  })

  it('never rewrites an existing case_id when a sibling is added or removed', () => {
    const harness = renderAdapterHarness()

    act(() => harness.actions().addGroup?.())
    const firstAdded = harness.data().cases[1]?.case_id
    expect(firstAdded).toBeTruthy()

    act(() => harness.actions().addGroup?.())
    expect(harness.data().cases[1]?.case_id).toBe(firstAdded)

    const doomed = harness.data().cases[2]
    act(() => harness.actions().removeGroup?.(doomed!.case_id))
    expect(harness.data().cases[1]?.case_id).toBe(firstAdded)
    expect(harness.data().cases[0]?.case_id).toBe('true')
  })

  it('mirrors every case_id into _targetBranches beside the reserved else', () => {
    const harness = renderAdapterHarness()

    act(() => harness.actions().addGroup?.())
    act(() => harness.actions().addGroup?.())

    const branchIds = harness.data()._targetBranches?.map((b) => b.id) ?? []
    const caseIds = harness.data().cases.map((c) => c.case_id)

    expect(branchIds).toEqual([...caseIds, 'false'])
  })
})
