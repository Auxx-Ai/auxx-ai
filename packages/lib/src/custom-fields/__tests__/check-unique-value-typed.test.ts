// packages/lib/src/custom-fields/__tests__/check-unique-value-typed.test.ts

import { describe, expect, it } from 'vitest'
import { UniqueValueConflictError } from '../../errors'
import { checkUniqueValueTyped } from '../check-unique-value-typed'

/**
 * Minimal fake Drizzle db: every builder step chains, `.limit()` returns a
 * thenable resolving to `rows` so `await query` works. `selectCalls` counts
 * how many queries were issued (one per array element).
 */
function buildFakeDb(rows: Array<{ entityId: string; displayName: string | null }>) {
  const state = { selectCalls: 0 }
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  chain.limit = () => Promise.resolve(rows)
  const db = {
    select: () => {
      state.selectCalls++
      return chain
    },
  }
  return { db: db as never, state }
}

const baseInput = {
  fieldId: 'field-email-1',
  organizationId: 'org-1',
  excludeEntityId: 'inst-self',
}

describe('checkUniqueValueTyped — array-aware (panel/bulk-edit door)', () => {
  it('returns true for null without querying', async () => {
    const { db, state } = buildFakeDb([{ entityId: 'x', displayName: null }])
    await expect(checkUniqueValueTyped({ ...baseInput, value: null }, db)).resolves.toBe(true)
    expect(state.selectCalls).toBe(0)
  })

  it('checks every element of an array input (one query per element)', async () => {
    const { db, state } = buildFakeDb([])
    const result = await checkUniqueValueTyped(
      {
        ...baseInput,
        value: [
          { type: 'text', value: 'a@x.com' },
          { type: 'text', value: 'b@x.com' },
        ],
      },
      db
    )
    expect(result).toBe(true)
    expect(state.selectCalls).toBe(2)
  })

  it('rejects an array containing a value claimed by another record', async () => {
    const { db } = buildFakeDb([{ entityId: 'inst-other', displayName: 'Jane Roe' }])
    const promise = checkUniqueValueTyped(
      { ...baseInput, value: [{ type: 'text', value: 'claimed@x.com' }] },
      db
    )
    await expect(promise).rejects.toThrow(UniqueValueConflictError)
    await promise.catch((e: UniqueValueConflictError) => {
      expect(e.conflictingValue).toBe('claimed@x.com')
      expect(e.existingEntityId).toBe('inst-other')
      expect(e.fieldId).toBe('field-email-1')
      expect(e.statusCode).toBe(409)
      expect(e.message).toContain('Jane Roe')
    })
  })

  it('rejects a scalar duplicate with the structured error', async () => {
    const { db } = buildFakeDb([{ entityId: 'inst-other', displayName: null }])
    await expect(
      checkUniqueValueTyped({ ...baseInput, value: { type: 'text', value: 'dup@x.com' } }, db)
    ).rejects.toThrow(UniqueValueConflictError)
  })

  it('empty array passes without querying', async () => {
    const { db, state } = buildFakeDb([{ entityId: 'x', displayName: null }])
    await expect(checkUniqueValueTyped({ ...baseInput, value: [] }, db)).resolves.toBe(true)
    expect(state.selectCalls).toBe(0)
  })
})
