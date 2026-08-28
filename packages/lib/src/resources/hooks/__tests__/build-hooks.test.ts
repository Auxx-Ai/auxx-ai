// packages/lib/src/resources/hooks/__tests__/build-hooks.test.ts
//
// The same failure `order-hooks.test.ts` and `purchasing-hooks.test.ts` pin, one
// entity later: `build_number` was declared creatable:false / updatable:false with
// "the hook is the ONLY writer" in its field registry, and no hook and no scope
// existed — so every build was created with a NULL number that no human could fill,
// and `build` declares `primaryDisplayField: 'number'`, so it rendered nameless.
// `HOOKS_BY_ENTITY_TYPE` returns `{}` for an unregistered entityType rather than
// throwing, so only a registration assertion catches it.

import { describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: vi.fn() },
}))

const { recordNumbering } = await import('../../../records/record-numbering')
const createMock = vi.mocked(recordNumbering.create)

const { BUILD_HOOKS } = await import('../build-hooks')
const { getSystemHooks, getHooksForAttribute } = await import('../system-hooks')

const FIELD_ID = 'field-build-number-1'

function buildContext(overrides: Partial<SystemHookContext> = {}): SystemHookContext {
  return {
    operation: 'create',
    entityDef: { id: 'def-build', entityType: 'build' },
    field: { id: FIELD_ID, type: 'TEXT', systemAttribute: 'build_number' },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
    ...overrides,
  } as unknown as SystemHookContext
}

describe('build_number issuance', () => {
  it('stamps a RecordSequence number on create, on the `build` scope', async () => {
    createMock.mockClear()
    createMock.mockResolvedValue({ recordNumber: 'B-0001', sequenceNumber: 1 })

    const values = await BUILD_HOOKS.build_number![0]!(buildContext())

    expect(createMock).toHaveBeenCalledWith('org-1', 'build')
    expect(values[FIELD_ID]).toBe('B-0001')
  })

  it('gives the next build the next number', async () => {
    createMock.mockClear()
    createMock.mockResolvedValue({ recordNumber: 'B-0002', sequenceNumber: 2 })

    const values = await BUILD_HOOKS.build_number![0]!(buildContext())

    expect(values[FIELD_ID]).toBe('B-0002')
  })

  it('does not re-issue on update — the number is stable for the record’s life', async () => {
    createMock.mockClear()

    const values = await BUILD_HOOKS.build_number![0]!(
      buildContext({ operation: 'update', values: { other: 1 } })
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ other: 1 })
  })

  it('leaves the rest of the write untouched', async () => {
    createMock.mockClear()
    createMock.mockResolvedValue({ recordNumber: 'B-0003', sequenceNumber: 3 })

    const values = await BUILD_HOOKS.build_number![0]!(
      buildContext({ values: { build_quantity_planned: 5 } })
    )

    expect(values).toEqual({ build_quantity_planned: 5, [FIELD_ID]: 'B-0003' })
  })
})

describe('build hook registration', () => {
  // The miss that would ship numberless builds: HOOKS_BY_ENTITY_TYPE is keyed by
  // EntityDefinition.entityType, and an absent key returns {} silently.
  it('is reachable through the entity-type registry, not just the module export', () => {
    expect(getSystemHooks('build')).toBe(BUILD_HOOKS)
    expect(getHooksForAttribute('build', 'build_number')).toHaveLength(1)
  })

  it('registers the number hook and nothing else', () => {
    expect(Object.keys(BUILD_HOOKS)).toEqual(['build_number'])
  })
})
