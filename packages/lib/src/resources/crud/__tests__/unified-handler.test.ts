// packages/lib/src/resources/crud/__tests__/unified-handler.test.ts

import { describe, expect, it, vi } from 'vitest'
import { UnifiedCrudHandler } from '../unified-handler'

// @auxx/database is globally mocked in src/test/setup.ts with chainable stubs,
// so `new UnifiedCrudHandler(...)` doesn't touch a real DB / Redis / event bus.
// We only need to stub the two methods findOrCreate calls directly.

describe('UnifiedCrudHandler.findOrCreate return shape', () => {
  it('found path returns the existing EntityInstanceEntity with .id', async () => {
    const handler = new UnifiedCrudHandler('org_1', 'user_1', {} as never)

    vi.spyOn(handler, 'findByField').mockResolvedValue({
      id: 'existing_id',
    } as never)

    const result = await handler.findOrCreate('contact', { primary_email: 'a@b.co' })

    expect(result.created).toBe(false)
    expect(result.instance.id).toBe('existing_id')
  })

  it('created path returns a bare EntityInstanceEntity, not a wrapped CreateEntityResult', async () => {
    const handler = new UnifiedCrudHandler('org_1', 'user_1', {} as never)

    vi.spyOn(handler, 'findByField').mockResolvedValue(null)
    vi.spyOn(handler, 'create').mockResolvedValue({
      instance: { id: 'new_id' } as never,
      recordId: 'contact:new_id' as never,
      values: {},
    })

    const result = await handler.findOrCreate('contact', { primary_email: 'c@d.co' })

    expect(result.created).toBe(true)
    // The created-path bug returned the full CreateEntityResult as `instance`,
    // which left `.id` undefined and exposed `.recordId` / `.values` / nested `.instance`.
    expect(result.instance.id).toBe('new_id')
    expect((result.instance as { recordId?: unknown }).recordId).toBeUndefined()
    expect((result.instance as { values?: unknown }).values).toBeUndefined()
    expect((result.instance as { instance?: unknown }).instance).toBeUndefined()
  })
})

describe('UnifiedCrudHandler bulk storage capability', () => {
  it.each([
    ['payout', false],
    ['processor_balance_entry', false],
    ['order', false],
    ['contact', false],
    [null, false],
  ] as const)('resolves definition type %s before advertising batch support', async (entityType, expected) => {
    const handler = new UnifiedCrudHandler('org_1', 'user_1', {} as never)
    const resolve = vi
      .spyOn(
        handler as unknown as {
          resolveEntityDefinition(id: string): Promise<{ entityType: string | null }>
        },
        'resolveEntityDefinition'
      )
      .mockResolvedValue({ entityType })
    expect(await handler.supportsBulkCreate('canonical-definition-id')).toBe(expected)
    expect(resolve).toHaveBeenCalledWith('canonical-definition-id')
  })
})
