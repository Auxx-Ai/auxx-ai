// packages/lib/src/resources/crud/__tests__/filter-condition-preflight.test.ts
//
// Retrieval plan §1.2 item 5/6 — `inspectFilterConditions` is the AI boundary's
// way to refuse a filter set that would silently widen. The UI query path in the
// same module keeps proceeding; only this function reports.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const entityBuild = vi.fn()
const entityValidate = vi.fn()
const systemBuild = vi.fn()
const systemValidate = vi.fn()

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => []),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../query-builder/entity-condition-builder', () => ({
  entityConditionBuilder: {
    buildGroupedQueryWithDiagnostics: (...args: unknown[]) => entityBuild(...args),
    validateConditionGroups: (...args: unknown[]) => entityValidate(...args),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

vi.mock('../../query-builder/system-condition-builder', () => ({
  systemConditionBuilder: {
    buildGroupedQueryWithDiagnostics: (...args: unknown[]) => systemBuild(...args),
    validateConditionGroups: (...args: unknown[]) => systemValidate(...args),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

import { inspectFilterConditions } from '../unified-handler-queries'

const clean = {
  sql: undefined,
  requestedConditions: 1,
  droppedConditions: [],
  allConditionsDropped: false,
}
const valid = { valid: true, errors: [] }

const filters = [
  {
    id: 'g1',
    logicalOperator: 'AND' as const,
    conditions: [{ id: 'c1', fieldId: 'status', operator: 'is' as const, value: 'OPEN' }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  entityBuild.mockReturnValue(clean)
  entityValidate.mockReturnValue(valid)
  systemBuild.mockReturnValue(clean)
  systemValidate.mockReturnValue(valid)
})

describe('inspectFilterConditions', () => {
  it('reports nothing when every condition builds', async () => {
    const report = await inspectFilterConditions({
      organizationId: 'org_1',
      entityDefinitionId: 'edf000000000000000000001',
      filters,
    })

    expect(report.message).toBeUndefined()
    expect(report.dropped).toEqual([])
    expect(report.validationErrors).toEqual([])
  })

  it('names the dropped filter and warns that the result would be wider', async () => {
    entityBuild.mockReturnValue({
      sql: undefined,
      requestedConditions: 1,
      droppedConditions: [
        {
          conditionId: 'c1',
          fieldRef: 'assignee_id',
          operator: 'is',
          reason: 'unresolved-field-or-operator',
        },
      ],
      allConditionsDropped: true,
    })

    const report = await inspectFilterConditions({
      organizationId: 'org_1',
      entityDefinitionId: 'edf000000000000000000001',
      filters,
    })

    expect(report.allConditionsDropped).toBe(true)
    expect(report.message).toContain("'assignee_id' is")
    expect(report.message).toContain('do NOT match')
  })

  it('folds validation errors into the message even when the clause built', async () => {
    entityValidate.mockReturnValue({ valid: false, errors: ['Group 1: Unknown field: nope'] })

    const report = await inspectFilterConditions({
      organizationId: 'org_1',
      entityDefinitionId: 'edf000000000000000000001',
      filters,
    })

    expect(report.dropped).toEqual([])
    expect(report.message).toContain('Unknown field: nope')
  })

  it('routes a system resource to the system builder', async () => {
    const report = await inspectFilterConditions({
      organizationId: 'org_1',
      entityDefinitionId: 'thread',
      filters,
    })

    expect(systemBuild).toHaveBeenCalledWith(filters, 'thread')
    expect(entityBuild).not.toHaveBeenCalled()
    expect(report.message).toBeUndefined()
  })
})
