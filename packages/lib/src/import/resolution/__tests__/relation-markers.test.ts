// packages/lib/src/import/resolution/__tests__/relation-markers.test.ts

import { describe, expect, it } from 'vitest'
import type { FieldWriteModes } from '../../types/execution'
import type { ResolutionConfig } from '../../types/resolution'
import { relationFieldWriteMode } from '../relation-policy'
import {
  isPendingRelationLookup,
  type PendingRelationLookupValue,
  resolveRelationCreate,
  resolveRelationMatch,
} from '../resolvers/relation'

function config(relation: Partial<NonNullable<ResolutionConfig['relationConfig']>>) {
  return {
    relationConfig: {
      relatedEntityDefinitionId: 'def-company',
      relationshipType: 'has_many' as const,
      ...relation,
    },
  }
}

function marker(resolved: { value?: unknown }): PendingRelationLookupValue {
  const value = resolved.value
  if (!isPendingRelationLookup(value)) throw new Error('not a pending relation lookup')
  return value
}

describe('relation markers carry the column policy', () => {
  it("resolveRelationMatch defaults to 'fail', the behaviour it has always had", () => {
    const m = marker(resolveRelationMatch('Acme', config({})))
    expect(m.__onNoMatch).toBe('fail')
  })

  it('resolveRelationMatch honours an explicit policy on the column', () => {
    expect(marker(resolveRelationMatch('Acme', config({ onNoMatch: 'blank' }))).__onNoMatch).toBe(
      'blank'
    )
  })

  it("resolveRelationCreate defaults to 'create'", () => {
    expect(marker(resolveRelationCreate('Acme', config({}))).__onNoMatch).toBe('create')
  })

  it('the POLICY wins over the resolution type when a stale row disagrees', () => {
    // `relation:create` with an explicit `'fail'` must fail. The resolution type
    // is derived FROM the policy, so the policy is the authority.
    expect(marker(resolveRelationCreate('Acme', config({ onNoMatch: 'fail' }))).__onNoMatch).toBe(
      'fail'
    )
  })

  it('carries the link mode through to the batch resolver', () => {
    expect(marker(resolveRelationMatch('Acme', config({ linkMode: 'set' }))).__linkMode).toBe('set')
  })
})

describe("has_many + 'add' preserves links the file never mentions", () => {
  it("maps onto the executor's FieldWriteModes 'add' bucket by default", () => {
    // 'add' is append + server-side dedup in `crudHandler.update`; 'set' is a
    // whole-field replace. A CSV column carrying ONE supplier must never be
    // read as "this part has only that supplier".
    const modes: FieldWriteModes = {}
    const mode = relationFieldWriteMode('has_many')
    if (mode) modes['cf-suppliers'] = mode

    expect(modes).toEqual({ 'cf-suppliers': 'add' })
  })

  it('only an EXPLICIT set replaces', () => {
    expect(relationFieldWriteMode('many_to_many', 'set')).toBe('set')
  })

  it('leaves single-valued relations out of FieldWriteModes entirely', () => {
    const modes: FieldWriteModes = {}
    const mode = relationFieldWriteMode('belongs_to')
    if (mode) modes['cf-supplier'] = mode
    expect(modes).toEqual({})
  })
})
