// apps/web/src/components/conditions/__tests__/condition-context-add-group.test.tsx

import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConditionProvider, useConditionActions } from '..'
import type { ConditionGroup, ConditionSystemConfig } from '../types'

type Actions = ReturnType<typeof useConditionActions>

function renderProvider(config: ConditionSystemConfig, groups: ConditionGroup[] = []) {
  const onGroupsChange = vi.fn()
  let actions: Actions | null = null

  function Capture() {
    actions = useConditionActions()
    return null
  }

  render(
    <ConditionProvider
      conditions={[]}
      groups={groups}
      config={config}
      onConditionsChange={() => {}}
      onGroupsChange={onGroupsChange}>
      <Capture />
    </ConditionProvider>
  )

  return {
    onGroupsChange,
    addGroup: () => act(() => actions?.addGroup?.()),
  }
}

const baseConfig: ConditionSystemConfig = {
  mode: 'variable',
  fields: 'dynamic',
  showGrouping: true,
}

describe('addGroupEnhanced', () => {
  it('stamps config.newGroupMetadata onto the group it creates', () => {
    const { onGroupsChange, addGroup } = renderProvider({
      ...baseConfig,
      newGroupMetadata: () => ({ case_id: 'minted-handle' }),
    })

    addGroup()

    const [created] = onGroupsChange.mock.calls.at(-1) as [ConditionGroup[]]
    expect(created).toHaveLength(1)
    expect(created[0]?.metadata?.case_id).toBe('minted-handle')
  })

  it('mints a fresh value per created group', () => {
    let n = 0
    const { onGroupsChange, addGroup } = renderProvider({
      ...baseConfig,
      newGroupMetadata: () => ({ case_id: `handle-${++n}` }),
    })

    addGroup()
    addGroup()

    const seen = onGroupsChange.mock.calls.map(
      ([groups]) => (groups as ConditionGroup[]).at(-1)?.metadata?.case_id
    )
    expect(seen).toEqual(['handle-1', 'handle-2'])
  })

  it('leaves group metadata untouched for surfaces that mint nothing', () => {
    const { onGroupsChange, addGroup } = renderProvider(baseConfig)

    addGroup()

    const [created] = onGroupsChange.mock.calls.at(-1) as [ConditionGroup[]]
    expect(created[0]?.metadata).toEqual({
      name: 'Group',
      description: '',
      subtext: '',
      collapsed: false,
    })
  })
})
