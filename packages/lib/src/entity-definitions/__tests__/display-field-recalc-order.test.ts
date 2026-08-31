// packages/lib/src/entity-definitions/__tests__/display-field-recalc-order.test.ts
//
// `EntityDefinitionService.update` must bust the org cache BEFORE recalculating
// display values, and the reason is invisible at the call site — which is
// exactly why it needs pinning.
//
// `recalculateDisplayFields` resolves the field it reads through
// `getCachedResource` → `getOrgCache().get(orgId, 'resources')`. That snapshot
// carries `primaryDisplayFieldId` as of when it was built, `updateEntityDefinition`
// performs no invalidation of its own, and the `resources` key has a ONE_DAY
// Redis TTL. So with the notify AFTER the recalc — where it sat originally — a
// display-field change recomputed every `displayName` from the OLD field and
// then cleared the cache: later READS looked right while the denormalized
// column stayed wrong indefinitely.
//
// Putting the bust first reads like a mistake (announce the change before the
// work is done?), so a future tidy-up is the likely regression. These tests
// fail loudly if it happens.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Ordered log of the two calls whose sequence is the invariant. */
const calls: string[] = []

const recalculateDisplayFields = vi.fn(async () => {
  calls.push('recalculate')
  return []
})

vi.mock('../notify', () => ({
  notifyEntityDefChanged: vi.fn(async () => {
    calls.push('notify')
  }),
}))

vi.mock('../../field-values', () => ({
  DisplayFieldService: class {
    recalculateDisplayFields = recalculateDisplayFields
  },
}))

const existing = {
  id: 'def-1',
  primaryDisplayFieldId: 'field-old',
  secondaryDisplayFieldId: null,
  avatarFieldId: null,
}

vi.mock('../get-entity-definition', () => ({
  getEntityDefinition: vi.fn(async () => ok(existing)),
}))

vi.mock('../update-entity-definition', () => ({
  updateEntityDefinition: vi.fn(async () =>
    ok({ ...existing, primaryDisplayFieldId: 'field-new' })
  ),
}))

// Unused by these tests, but the service imports them at module load.
vi.mock('../create-entity-definition', () => ({ createEntityDefinition: vi.fn() }))
vi.mock('../delete-entity-definition', () => ({ deleteEntityDefinitionDeep: vi.fn() }))
vi.mock('../get-entity-definition-by-slug', () => ({ getEntityDefinitionBySlug: vi.fn() }))
vi.mock('../list-entity-definitions', () => ({ listEntityDefinitions: vi.fn() }))

const { EntityDefinitionService } = await import('../entity-definition-service')

describe('EntityDefinitionService.update — cache bust precedes display recalc', () => {
  beforeEach(() => {
    calls.length = 0
    recalculateDisplayFields.mockClear()
  })

  it('busts the cache BEFORE recalculating, not after', async () => {
    const service = new EntityDefinitionService('org-1', 'user-1')
    await service.update('def-1', { primaryDisplayFieldId: 'field-new' })

    // 🛑 If this reads ['recalculate', 'notify'], the recalc ran against a
    // resources snapshot still naming the OLD display field and every
    // `displayName` it wrote is wrong.
    expect(calls).toEqual(['notify', 'recalculate'])
  })

  it('still busts the cache when no display field changed', async () => {
    const service = new EntityDefinitionService('org-1', 'user-1')
    await service.update('def-1', { primaryDisplayFieldId: existing.primaryDisplayFieldId })

    // The notify is unconditional — every def update invalidates — while the
    // recalc is gated on a pointer actually moving.
    expect(calls).toEqual(['notify'])
    expect(recalculateDisplayFields).not.toHaveBeenCalled()
  })

  it('a failed recalc does not swallow the cache bust that already happened', async () => {
    recalculateDisplayFields.mockImplementationOnce(async () => {
      calls.push('recalculate')
      throw new Error('boom')
    })

    const service = new EntityDefinitionService('org-1', 'user-1')

    // The recalc is best-effort by design — it must not fail the update.
    await expect(
      service.update('def-1', { primaryDisplayFieldId: 'field-new' })
    ).resolves.toBeDefined()

    expect(calls).toEqual(['notify', 'recalculate'])
  })
})
