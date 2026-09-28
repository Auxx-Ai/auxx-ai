// packages/lib/src/resources/hooks/__tests__/part-hooks.test.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { PART_HOOKS } from '../part-hooks'
import type { SystemHookContext } from '../types'

const sellableField = {
  id: 'f_sellable',
  name: 'Sellable',
  systemAttribute: 'part_sellable',
} as CustomFieldEntity
const kindField = {
  id: 'f_kind',
  name: 'Part Kind',
  systemAttribute: 'part_kind',
} as CustomFieldEntity

async function run(
  values: Record<string, unknown>,
  operation: 'create' | 'update' = 'create'
): Promise<Record<string, unknown>> {
  const [hook] = PART_HOOKS.part_sellable ?? []
  return hook!({
    operation,
    entityDef: { id: 'part_def', entityType: 'part', apiSlug: 'parts' },
    field: sellableField,
    values,
    organizationId: 'org_1',
    userId: 'user_1',
    allFields: [sellableField, kindField],
  } as SystemHookContext)
}

describe('part_sellable default (107 D3)', () => {
  it('defaults on for services and finished goods', async () => {
    expect((await run({ part_kind: 'service' })).part_sellable).toBe(true)
    expect((await run({ f_kind: ['finished_good'] })).part_sellable).toBe(true)
    expect((await run({ part_kind: { type: 'option', optionId: 'service' } })).part_sellable).toBe(
      true
    )
  })

  it('defaults off for components, subassemblies and an unset kind', async () => {
    expect((await run({ part_kind: 'component' })).part_sellable).toBe(false)
    expect((await run({ part_kind: 'subassembly' })).part_sellable).toBe(false)
    expect((await run({})).part_sellable).toBe(false)
  })

  it('keeps an explicit value, by any key', async () => {
    expect((await run({ part_kind: 'service', part_sellable: false })).part_sellable).toBe(false)
    const byId = await run({ part_kind: 'component', f_sellable: true })
    expect(byId).toEqual({ part_kind: 'component', f_sellable: true })
  })

  it('leaves updates alone', async () => {
    expect(await run({ part_kind: 'service' }, 'update')).toEqual({ part_kind: 'service' })
  })
})

describe('part_kind resets the kind-conflict confirmation (plans/mrp/17 D3)', () => {
  const flagField = {
    id: 'f_flag',
    name: 'Kind Conflict Confirmed',
    systemAttribute: 'part_kind_conflict_confirmed',
  } as CustomFieldEntity

  async function runKind(
    values: Record<string, unknown>,
    operation: 'create' | 'update',
    allFields = [kindField, flagField]
  ): Promise<Record<string, unknown>> {
    const [hook] = PART_HOOKS.part_kind ?? []
    return hook!({
      operation,
      entityDef: { id: 'part_def', entityType: 'part', apiSlug: 'parts' },
      field: kindField,
      values,
      organizationId: 'org_1',
      userId: 'user_1',
      allFields,
    } as SystemHookContext)
  }

  it('clears the flag on an update that writes the kind', async () => {
    expect(await runKind({ part_kind: 'component' }, 'update')).toEqual({
      part_kind: 'component',
      f_flag: false,
    })
  })

  it('keeps a flag the same update sets, and leaves creates alone', async () => {
    const keep = { part_kind: 'finished_good', part_kind_conflict_confirmed: true }
    expect(await runKind(keep, 'update')).toEqual(keep)
    expect(await runKind({ part_kind: 'component' }, 'create')).toEqual({ part_kind: 'component' })
  })

  it('does nothing in an org without the flag field', async () => {
    expect(await runKind({ part_kind: 'component' }, 'update', [kindField])).toEqual({
      part_kind: 'component',
    })
  })
})
