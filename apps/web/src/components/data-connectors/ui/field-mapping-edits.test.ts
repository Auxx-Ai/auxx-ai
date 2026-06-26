// apps/web/src/components/data-connectors/ui/field-mapping-edits.test.ts

import { describe, expect, it } from 'vitest'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import {
  bareTokenSource,
  bindingFor,
  isBareToken,
  removeBindingForSource,
  retargetFormulaEntry,
  setEntryIdentityRole,
  upsertBinding,
} from './field-mapping-edits'

describe('isBareToken / bareTokenSource', () => {
  it('detects a single-token expression', () => {
    expect(isBareToken('{email}')).toBe(true)
    expect(isBareToken('{customer.email}')).toBe(true)
    expect(isBareToken('{a}-{b}')).toBe(false)
    expect(isBareToken('{a} {b}')).toBe(false)
  })
  it('extracts the source path', () => {
    expect(bareTokenSource('{customer.email}')).toBe('customer.email')
  })
})

describe('bindingFor', () => {
  it('builds an identity-mapped bare-token binding', () => {
    const b = bindingFor('email', 'contact:email')
    expect(b.expression).toBe('{email}')
    expect(b.sourceFields).toEqual({ email: 'email' })
    expect(b.targetFieldRef).toBe('contact:email')
    expect(b.id).toBeTruthy()
  })
})

describe('upsertBinding', () => {
  it('replaces a prior bare-token binding on the same source (1 source → 1 target)', () => {
    const entries: FieldMapping[] = [
      {
        id: '1',
        targetFieldRef: 'contact:first_name',
        expression: '{email}',
        sourceFields: { email: 'email' },
      },
      {
        id: '2',
        targetFieldRef: 'order:total',
        expression: '{total}',
        sourceFields: { total: 'total' },
      },
    ]
    const next = upsertBinding(entries, 'email', 'contact:email')
    // the `{email}` row is replaced, `{total}` untouched
    expect(next.filter((e) => bareTokenSource(e.expression) === 'email')).toHaveLength(1)
    expect(next.find((e) => bareTokenSource(e.expression) === 'email')?.targetFieldRef).toBe(
      'contact:email'
    )
    expect(next.find((e) => e.id === '2')).toBeTruthy()
  })
})

describe('removeBindingForSource', () => {
  it('drops only the matching bare-token entry', () => {
    const entries: FieldMapping[] = [
      {
        id: '1',
        targetFieldRef: 'contact:email',
        expression: '{email}',
        sourceFields: { email: 'email' },
      },
      {
        id: '2',
        targetFieldRef: 'order:total',
        expression: '{total}',
        sourceFields: { total: 'total' },
      },
    ]
    expect(removeBindingForSource(entries, 'email')).toEqual([entries[1]])
  })
})

describe('retargetFormulaEntry', () => {
  it('swaps the target but preserves expression, sourceFields, id, and role', () => {
    const entry: FieldMapping = {
      id: 'f1',
      targetFieldRef: 'order:full_name',
      expression: 'concat({first}, " ", {last})',
      sourceFields: { first: 'first', last: 'last' },
      mergeStrategy: 'overwrite',
    }
    const next = retargetFormulaEntry(entry, 'contact:full_name')
    expect(next.targetFieldRef).toBe('contact:full_name')
    expect(next.id).toBe('f1')
    expect(next.expression).toBe('concat({first}, " ", {last})')
    expect(next.sourceFields).toEqual({ first: 'first', last: 'last' })
    expect(next.mergeStrategy).toBe('overwrite')
  })
})

describe('setEntryIdentityRole', () => {
  const entries: FieldMapping[] = [
    {
      id: 'a',
      targetFieldRef: 'contact:email',
      expression: '{email}',
      sourceFields: { email: 'email' },
    },
    {
      id: 'b',
      targetFieldRef: 'contact:external_id',
      expression: '{cid}',
      sourceFields: { cid: 'cid' },
      identityRole: { kind: 'externalId' },
    },
  ]

  it('makes External ID a radio — picking it clears the prior one', () => {
    const next = setEntryIdentityRole(entries, 'a', 'externalId')
    expect(next.find((e) => e.id === 'a')?.identityRole).toEqual({ kind: 'externalId' })
    expect(next.find((e) => e.id === 'b')?.identityRole).toBeUndefined()
  })

  it('sets a match role with normalize and leaves External ID alone', () => {
    const next = setEntryIdentityRole(entries, 'a', 'match', 'email')
    expect(next.find((e) => e.id === 'a')?.identityRole).toEqual({
      kind: 'match',
      normalize: 'email',
    })
    expect(next.find((e) => e.id === 'b')?.identityRole).toEqual({ kind: 'externalId' })
  })

  it('clears a role with null', () => {
    const next = setEntryIdentityRole(entries, 'b', null)
    expect(next.find((e) => e.id === 'b')?.identityRole).toBeUndefined()
  })
})
