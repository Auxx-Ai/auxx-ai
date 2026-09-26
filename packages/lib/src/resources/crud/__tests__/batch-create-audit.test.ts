// packages/lib/src/resources/crud/__tests__/batch-create-audit.test.ts
//
// Every hook a CRUD create runs for a batch-eligible definition, pinned against its audit entry:
// a new hook on an eligible def fails here, so the batched create cannot silently bypass it
// (plans/mrp/12-slice-batched-backflush.md §2). Equivalence is the int suite's.

import type { CustomFieldEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { getEntityPreCreateHooks, hasFieldPreHooks } from '../../../field-hooks/registry'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../../seed/entity-seeder/constants'
import { getCommonHooks, getSystemHooks } from '../../hooks'
import { BUILD_FIELDS } from '../../registry/resources/build-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../registry/resources/stock-movement-fields'
import type { Resource } from '../../registry/types'
import { BATCH_CREATE_AUDITS, planBatchCreate } from '../batch-create-audit'
import { batchCreateLane } from '../create-entities-batch'
import { interactiveSession, quietSession, seedSession, type WriteSession } from '../write-origin'

/** The registry fields of every audited def; an audit entry without one fails below. */
const REGISTRY_FIELDS: Record<string, object> = {
  stock_movement: STOCK_MOVEMENT_FIELDS,
  build: BUILD_FIELDS,
}

describe.each(
  Object.entries(BATCH_CREATE_AUDITS)
)('the hooks a %s create runs', (entityType, audit) => {
  const slug = SYSTEM_ENTITIES.find((def) => def.entityType === entityType)?.apiSlug as string
  const fields = Object.values(REGISTRY_FIELDS[entityType] ?? {}) as Array<{
    key: string
    fieldType: string
    systemAttribute?: string
    isUnique?: boolean
  }>

  it('has registry fields and a slug to audit', () => {
    expect(fields.length).toBeGreaterThan(0)
    expect(slug).toBeTruthy()
  })

  it('system hooks: exactly the audited ones, plus the common created_by stamp', () => {
    expect(Object.keys(getSystemHooks(entityType)).sort()).toEqual(
      Object.keys(audit.systemHooks).sort()
    )
    expect(Object.keys(getCommonHooks())).toEqual(['created_by_id'])
  })

  it('entity pre-create hooks: the audited count', () => {
    expect(getEntityPreCreateHooks(slug)).toHaveLength(audit.entityPreCreateHooks)
  })

  it('field pre-hooks: exactly the audited attributes', () => {
    const hooked = fields
      .filter(
        (field) => field.systemAttribute && hasFieldPreHooks(slug, field.systemAttribute as never)
      )
      .map((field) => field.systemAttribute)
    expect(hooked.sort()).toEqual([...audit.fieldPreHooks].sort())
  })

  it('unique fields: none, since the batch cannot check one per row', () => {
    expect(fields.filter((field) => field.isUnique).map((field) => field.key)).toEqual([])
  })

  it('display fields: computable in a batch', () => {
    const display = DISPLAY_FIELD_CONFIG[entityType]
    const types = [display?.primaryDisplayField, display?.secondaryDisplayField].map(
      (key) => fields.find((field) => field.key === key)?.fieldType
    )
    expect(types.filter((type) => type === 'NAME' || type === 'FILE')).toEqual([])
    expect((display as { avatarField?: string } | undefined)?.avatarField).toBeUndefined()
  })
})

describe('planBatchCreate', () => {
  const resource = (over: Partial<Resource> & { entityType?: string }): Resource =>
    ({
      id: 'def_1',
      entityDefinitionId: 'def_1',
      type: 'custom',
      apiSlug: 'widgets',
      fields: [],
      display: { primaryDisplayField: null, secondaryDisplayField: null, avatarField: null },
      ...over,
    }) as unknown as Resource
  const field = (over: Partial<CustomFieldEntity>): CustomFieldEntity =>
    ({
      id: 'f_1',
      name: 'Name',
      type: 'TEXT',
      systemAttribute: null,
      isUnique: false,
      ...over,
    }) as CustomFieldEntity

  it('accepts a user-authored def with no hooks', () => {
    expect(planBatchCreate(resource({}), [field({})])).toEqual({ ok: true, ranges: [] })
  })

  it('allocates the build number as a range', () => {
    expect(planBatchCreate(resource({ entityType: 'build', apiSlug: 'builds' }), [])).toEqual({
      ok: true,
      ranges: [{ systemAttribute: 'build_number', scope: 'build' }],
    })
  })

  it.each([
    ['an unaudited system def', resource({ entityType: 'contact', apiSlug: 'contacts' }), []],
    ['a unique field', resource({}), [field({ isUnique: true })]],
    [
      'a composed-name display',
      resource({
        display: {
          primaryDisplayField: { id: 'f_1', name: 'Name', type: 'NAME' },
          secondaryDisplayField: null,
          avatarField: null,
        },
      } as never),
      [],
    ],
    [
      'an avatar display',
      resource({
        display: {
          primaryDisplayField: null,
          secondaryDisplayField: null,
          avatarField: { id: 'f_2', name: 'Logo', type: 'FILE' },
        },
      } as never),
      [],
    ],
    ['a def whose slug carries a pre-create hook', resource({ apiSlug: 'tariff-codes' }), []],
  ])('refuses %s', (_name, def, fields) => {
    expect(planBatchCreate(def, fields as CustomFieldEntity[]).ok).toBe(false)
  })
})

describe('batchCreateLane', () => {
  const sync: WriteSession = {
    origin: { kind: 'sync', source: 'import', ref: 'job_1', collector: {} as never },
    depth: 0,
  }

  it.each([
    ['quiet', quietSession('test'), 'quiet'],
    ['sync', sync, 'sync'],
    ['interactive', interactiveSession('user_1'), null],
    ['seed', seedSession('test'), null],
    ['quiet over sync', quietSession('test', { base: sync }), null],
  ])('%s', (_name, session, lane) => {
    expect(batchCreateLane(session)).toBe(lane)
  })
})
