// packages/lib/src/resources/grouping/__tests__/group-order.test.ts
//
// SQL shape of the table group order, rendered through PgDialect against a local
// `EntityInstance` stand-in (the default config mocks the real schema to `{}`).

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { type SQL, sql } from 'drizzle-orm'
import { PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedMembers: vi.fn(async () => [
    { user: { id: 'u_zed', name: 'Zed' } },
    { user: { id: 'u_amy', name: 'amy' } },
  ]),
  getCachedAgents: vi.fn(async () => [{ id: 'ag_1', name: 'Mona', userId: 'u_mona' }]),
  getCachedGroups: vi.fn(async () => [{ id: 'grp_1', displayName: 'Billing' }]),
}))

import { UnprocessableEntityError } from '../../../errors'
import { BaseType } from '../../../workflow-engine/core/types'
import type { EntityQueryContext } from '../../query-builder/entity-condition-builder'
import type { ResourceField } from '../../registry/field-types'
import { EMPTY_GROUP_KEY } from '../client'
import {
  buildGroupOrderBy,
  excludeGroupKeysWhere,
  loadActorGroupOrder,
  resolveGroupField,
  resolveGroupOrder,
} from '../group-order'

const EntityInstance = pgTable('EntityInstance', {
  id: text().primaryKey(),
  createdAt: timestamp({ precision: 3 }),
  displayName: text(),
})

const DEF = 'def_1'
const caps = { filterable: true, sortable: true, creatable: true, updatable: true }

function field(
  id: string,
  fieldType: string,
  extra: Partial<ResourceField> & Record<string, unknown> = {}
): ResourceField {
  return {
    id: toFieldId(id),
    resourceFieldId: toResourceFieldId(DEF, id),
    key: id,
    label: id,
    type: BaseType.STRING,
    fieldType,
    capabilities: caps,
    ...extra,
  } as ResourceField
}

const status = field('status', 'SINGLE_SELECT', {
  options: {
    options: [
      { id: 'opt_open', value: 'open', label: 'Open' },
      { id: 'opt_done', value: 'done', label: 'Done' },
    ],
  },
} as never)
const company = field('company', 'RELATIONSHIP', {
  relationship: { relationshipType: 'belongs_to', inverseResourceFieldId: 'x:y' },
} as never)
const contacts = field('contacts', 'RELATIONSHIP', {
  relationship: { relationshipType: 'has_many', inverseResourceFieldId: 'x:y' },
} as never)
const owner = field('owner', 'ACTOR')
const done = field('done', 'CHECKBOX')
const due = field('due', 'DATE')
const seen = field('seen', 'DATETIME')
const created = field('createdAt', 'DATETIME', { isSystem: true, dbColumn: 'createdAt' })
const note = field('note', 'TEXT')
const tags = field('tags', 'MULTI_SELECT')
const hidden = field('secret', 'SINGLE_SELECT', {
  capabilities: { ...caps, hidden: true },
} as never)
const calc = field('calc', 'CALC', {
  options: { calc: { resultFieldType: 'CHECKBOX' } },
} as never)

const context: EntityQueryContext = {
  fields: [status, company, contacts, owner, done, due, seen, created, note, tags, hidden, calc],
  outerTable: EntityInstance as never,
}

const dialect = new PgDialect()
const render = (parts: SQL | SQL[]) =>
  dialect.sqlToQuery(Array.isArray(parts) ? sql.join(parts, sql`, `) : parts)

const ref = (id: string) => toResourceFieldId(DEF, id)

function build(f: ResourceField, over: { desc?: boolean; dateGranularity?: 'month' } = {}) {
  return buildGroupOrderBy({
    field: f,
    groupBy: { fieldId: f.resourceFieldId as string, ...over },
    context,
    timezone: 'Europe/Berlin',
    actorOrder: ['u_amy', 'u_zed'],
  })
}

describe('buildGroupOrderBy', () => {
  it('SINGLE_SELECT ranks by option order over BOTH option keyspaces, then the key', () => {
    const { keyExpr, orderBy } = build(status)
    const key = render(keyExpr)
    expect(key.sql).toContain('"FieldValue"."optionId"')
    expect(key.sql).toContain('"FieldValue"."entityId" = "EntityInstance"."id"')

    const order = render(orderBy)
    expect(order.sql).toMatch(/^array_position\(ARRAY\[\$\d+, \$\d+, \$\d+, \$\d+\]::text\[\]/)
    expect(order.params.slice(0, 4)).toEqual(['opt_open', 'open', 'opt_done', 'done'])
    expect(orderBy).toHaveLength(2)
    expect(render(orderBy[1]!).sql).toBe(`${render(keyExpr).sql} ASC NULLS LAST`)
  })

  it('RELATIONSHIP ranks by the related displayName with the raw key as tie-break', () => {
    const { keyExpr, orderBy } = build(company)
    expect(render(keyExpr).sql).toContain('"FieldValue"."relatedEntityId"')
    const [rank, tie] = orderBy.map((o) => render(o).sql)
    expect(rank).toContain('SELECT "grp_ei"."displayName" FROM "EntityInstance" "grp_ei"')
    expect(rank).toMatch(/ASC NULLS LAST$/)
    expect(tie).toBe(`${render(keyExpr).sql} ASC NULLS LAST`)
  })

  it('ACTOR reads split storage and ranks against the supplied actor order', () => {
    const { keyExpr, orderBy } = build(owner)
    expect(render(keyExpr).sql).toContain(
      'COALESCE("FieldValue"."actorId", "FieldValue"."relatedEntityId")'
    )
    const order = render(orderBy[0]!)
    expect(order.sql).toMatch(/^array_position\(ARRAY\[\$\d+, \$\d+\]::text\[\]/)
    expect(order.params.slice(0, 2)).toEqual(['u_amy', 'u_zed'])
  })

  it('CHECKBOX orders by the text key alone (false before true)', () => {
    const { keyExpr, orderBy } = build(done)
    expect(render(keyExpr).sql).toContain('"FieldValue"."valueBoolean"')
    expect(render(keyExpr).sql).toMatch(/\)::text$/)
    expect(orderBy).toHaveLength(1)
  })

  it('DATETIME buckets in the viewer timezone; DATE buckets in UTC', () => {
    const dt = render(build(seen, { dateGranularity: 'month' }).keyExpr)
    expect(dt.sql).toContain('to_char(date_trunc(')
    expect(dt.sql).toContain('"FieldValue"."valueDate"')
    expect(dt.params).toContain('Europe/Berlin')
    expect(dt.params).toContain('month')

    const d = render(build(due).keyExpr)
    expect(d.params).toContain('UTC')
    expect(d.params).toContain('day')
    expect(d.params).not.toContain('Europe/Berlin')
  })

  it('a system field with an EntityInstance column uses the column, not FieldValue', () => {
    const k = render(build(created).keyExpr)
    expect(k.sql).not.toContain('FieldValue')
    expect(k.sql).toContain(`("EntityInstance"."createdAt" AT TIME ZONE 'UTC')`)
  })

  it('NULLS LAST under both directions', () => {
    for (const f of [status, company, owner, done, seen]) {
      for (const order of build(f, { desc: true }).orderBy) {
        expect(render(order).sql).toMatch(/ DESC NULLS LAST$/)
      }
      for (const order of build(f).orderBy) {
        expect(render(order).sql).toMatch(/ ASC NULLS LAST$/)
      }
    }
  })

  it('orderByKey applies the same order to an already-computed key', () => {
    const order = build(status).orderByKey(sql`"grp"."key"`)
    expect(render(order).sql).toContain('"grp"."key") ASC NULLS LAST, "grp"."key" ASC NULLS LAST')
  })
})

describe('resolveGroupField', () => {
  it('resolves by ResourceFieldId', () => {
    expect(resolveGroupField(ref('status'), context)).toBe(status)
  })

  it.each([
    ['text', 'note'],
    ['multi-select', 'tags'],
    ['has-many relationship', 'contacts'],
    ['hidden', 'secret'],
    ['calc', 'calc'],
  ])('refuses an ineligible %s field', (_label, id) => {
    expect(() => resolveGroupField(ref(id), context)).toThrow(UnprocessableEntityError)
  })

  it('refuses unknown fields and relationship paths', () => {
    expect(() => resolveGroupField(ref('nope'), context)).toThrow(UnprocessableEntityError)
    expect(() => resolveGroupField(`${ref('company')}::name`, context)).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('resolveGroupOrder', () => {
  it('requires a valid timezone for DATETIME fields', async () => {
    await expect(
      resolveGroupOrder({ organizationId: 'o', groupBy: { fieldId: ref('seen') }, context })
    ).rejects.toThrow(UnprocessableEntityError)
    await expect(
      resolveGroupOrder({
        organizationId: 'o',
        groupBy: { fieldId: ref('seen') },
        context,
        timezone: 'Mars/Olympus',
      })
    ).rejects.toThrow(UnprocessableEntityError)
  })

  it('loads the actor order for ACTOR fields', async () => {
    const order = await resolveGroupOrder({
      organizationId: 'o',
      groupBy: { fieldId: ref('owner') },
      context,
    })
    expect(render(order.orderBy[0]!).params.slice(0, 5)).toEqual([
      'u_amy',
      'grp_1',
      'ag_1',
      'u_mona',
      'u_zed',
    ])
  })
})

describe('loadActorGroupOrder', () => {
  it('sorts every actor kind by display name, case-insensitively', async () => {
    expect(await loadActorGroupOrder('o')).toEqual(['u_amy', 'grp_1', 'ag_1', 'u_mona', 'u_zed'])
  })
})

describe('excludeGroupKeysWhere', () => {
  const key = sql`k`
  it('keeps the null group when only real keys are excluded', () => {
    const q = render(excludeGroupKeysWhere(key, ['a', 'b'])!)
    expect(q.sql).toBe('((k) IS NULL OR NOT ((k) = ANY(ARRAY[$1, $2]::text[])))')
    expect(q.params).toEqual(['a', 'b'])
  })

  it('drops the null group for the empty key', () => {
    expect(render(excludeGroupKeysWhere(key, [EMPTY_GROUP_KEY])!).sql).toBe('(k) IS NOT NULL')
    expect(render(excludeGroupKeysWhere(key, [EMPTY_GROUP_KEY, 'a'])!).sql).toBe(
      '((k) IS NOT NULL AND NOT ((k) = ANY(ARRAY[$1]::text[])))'
    )
  })

  it('adds nothing for an empty list', () => {
    expect(excludeGroupKeysWhere(key, [])).toBeUndefined()
  })
})
