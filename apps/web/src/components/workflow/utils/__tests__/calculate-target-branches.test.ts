// apps/web/src/components/workflow/utils/__tests__/calculate-target-branches.test.ts

import { describe, expect, it } from 'vitest'
import type { FlowNode } from '../../types'
import { NodeType } from '../../types/node-types'
import { calculateTargetBranches } from '../workflow-initializer'

/**
 * `calculateTargetBranches` had four arms; two of them (`HTTP`, `CRUD`)
 * existed only to add the `fail` branch and were two copies of one rule. They
 * now read the manifest's `errorHandling` declaration through the same shared
 * helper the catalog and the engine's graph builder use, so a type either
 * declares failure handling everywhere or nowhere (plan 21 §15.4/§16.2).
 */
const dataFor = (data: Record<string, unknown>) => data as unknown as FlowNode['data']

describe('calculateTargetBranches — failure policy comes off the manifest', () => {
  it.each([
    NodeType.HTTP,
    NodeType.CRUD,
  ])('%s gets a fail lane when error_strategy is fail', (type) => {
    expect(calculateTargetBranches(dataFor({ type, error_strategy: 'fail' }))).toEqual([
      { id: 'source', name: '', type: 'default' },
      { id: 'fail', name: 'Fail', type: 'fail' },
    ])
  })

  it.each([NodeType.HTTP, NodeType.CRUD])('%s gets source alone otherwise', (type) => {
    for (const strategy of ['continue', 'default', undefined]) {
      expect(calculateTargetBranches(dataFor({ type, error_strategy: strategy }))).toEqual([
        { id: 'source', name: '', type: 'default' },
      ])
    }
  })

  it("reads http's legacy `none` as continue", () => {
    // Persisted http nodes carry 'none'; it is the old spelling of `continue`
    // and must never produce a lane.
    expect(
      calculateTargetBranches(dataFor({ type: NodeType.HTTP, error_strategy: 'none' }))
    ).toEqual([{ id: 'source', name: '', type: 'default' }])
  })

  it('returns undefined for a type that declares no errorHandling', () => {
    // Setting the field on a type that never opted in must not conjure a lane.
    expect(
      calculateTargetBranches(dataFor({ type: NodeType.AI, error_strategy: 'fail' }))
    ).toBeUndefined()
    expect(calculateTargetBranches(dataFor({ type: NodeType.WAIT }))).toBeUndefined()
  })

  it('leaves the genuinely type-specific arms alone', () => {
    expect(
      calculateTargetBranches(dataFor({ type: NodeType.IF_ELSE, cases: [{ case_id: 'true' }] }))
    ).toEqual([
      { id: 'true', name: 'IF', type: 'default' },
      { id: 'false', name: 'ELSE', type: 'default' },
    ])
    expect(
      calculateTargetBranches(dataFor({ type: NodeType.TEXT_CLASSIFIER, outputMode: 'variable' }))
    ).toEqual([{ id: 'source', name: '', type: 'default' }])
  })
})
