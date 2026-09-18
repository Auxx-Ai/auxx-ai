// packages/lib/src/data-migrations/migrations/__tests__/170-gl-account-parent-field.test.ts

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { GL_ACCOUNT_FIELDS } from '../../../resources/registry/resources/gl-account-fields'
import { ENTITY_INSTANCE_COLUMNS } from '../../../seed/entity-seeder/constants'
import { FIELD_REGISTRY } from '../../../seed/entity-seeder/create-fields'
import { shouldCreateField } from '../../../seed/entity-seeder/utils'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../../registry'
import { migration170GlAccountParentField } from '../170-gl-account-parent-field'

const MIGRATION_ID = '170-gl-account-parent-field'

describe('migration 170 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves every registered id on a distinct number, and 170 is its own', () => {
    const numbers = PER_ORG_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id.split('-')[0] === '170')).toHaveLength(1)
  })

  it('exports the migration it registers', () => {
    expect(PER_ORG_MIGRATIONS).toContain(migration170GlAccountParentField)
  })

  it('reaches the shared data-migration registry without an entry of its own', () => {
    expect(ALL_DATA_MIGRATIONS.filter((m) => m.id === MIGRATION_ID)).toHaveLength(1)
  })

  it('sorts into the registry by id', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThanOrEqual(0)
  })
})

describe('gl_account.parent / children (D1)', () => {
  it('resolves the same field map object identity used by the seeder', () => {
    expect(FIELD_REGISTRY.gl_account).toBe(GL_ACCOUNT_FIELDS)
  })

  it('both carry a systemAttribute in the shared union', () => {
    expect(SYSTEM_ATTRIBUTES).toContain(GL_ACCOUNT_FIELDS.parent?.systemAttribute)
    expect(SYSTEM_ATTRIBUTES).toContain(GL_ACCOUNT_FIELDS.children?.systemAttribute)
  })

  it("shouldCreateField says yes to both, so migration 170's ensureCustomFields inserts them", () => {
    expect(shouldCreateField(GL_ACCOUNT_FIELDS.parent!, ENTITY_INSTANCE_COLUMNS)).toBe(true)
    expect(shouldCreateField(GL_ACCOUNT_FIELDS.children!, ENTITY_INSTANCE_COLUMNS)).toBe(true)
  })

  it('points parent at children and back, self-referential, belongs_to / has_many', () => {
    expect(GL_ACCOUNT_FIELDS.parent?.relationship).toMatchObject({
      inverseResourceFieldId: 'gl_account:children',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(GL_ACCOUNT_FIELDS.children?.relationship).toMatchObject({
      inverseResourceFieldId: 'gl_account:parent',
      relationshipType: 'has_many',
      isInverse: true,
    })
  })

  it('caps depth at 5 and refuses a cycle, at the field declaration (D4)', () => {
    expect(GL_ACCOUNT_FIELDS.parent?.relationship?.constraints).toEqual({
      preventCircular: true,
      maxDepth: 5,
    })
  })

  it('gives children the restrict onDelete (D6: no cascade in either direction)', () => {
    expect(GL_ACCOUNT_FIELDS.children?.relationship?.onDelete).toBe('restrict')
    expect(GL_ACCOUNT_FIELDS.parent?.relationship?.onDelete).toBeUndefined()
  })

  it('keeps children out of the panel and lets parent be set by a person', () => {
    expect(GL_ACCOUNT_FIELDS.children?.showInPanel).toBe(false)
    expect(GL_ACCOUNT_FIELDS.parent?.capabilities.creatable).toBe(true)
    expect(GL_ACCOUNT_FIELDS.parent?.capabilities.updatable).toBe(true)
    expect(GL_ACCOUNT_FIELDS.parent?.nullable).toBe(true)
  })
})
