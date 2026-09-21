// packages/lib/src/resources/system-records/__tests__/find-by-value.test.ts
//
// The inverse lookup 25 files re-typed. What matters is the SCOPE (org, def and
// live-only, which several copies had dropped), the intersection of composite
// criteria, and the key the answer comes back under.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../../database/src/db/schema/index'),
}))

import { findSystemRecordIdsByValue, type SystemValueContext } from '../find-by-value'

type Attribute = 'code' | 'order' | 'status' | 'amount'

const ORG = 'org_1'

const ctx: SystemValueContext<Attribute> = {
  defId: 'def_1',
  fields: {
    code: { id: 'f_code' },
    order: { id: 'f_order' },
    status: { id: 'f_status' },
    amount: { id: 'f_amount' },
  },
}

type Query = { joins: unknown[]; where: unknown }

/** A db whose every query answers from `pages` in order, recording its joins and scope. */
function db(pages: unknown[][]) {
  const queries: Query[] = []
  const conn = {
    select: () => ({
      from: () => {
        const joins: unknown[] = []
        const builder = {
          $dynamic: () => builder,
          innerJoin: (_table: unknown, on: unknown) => {
            joins.push(on)
            return builder
          },
          where: (where: unknown) => {
            queries.push({ joins, where })
            const rows = pages[queries.length - 1] ?? []
            const result = Promise.resolve(rows)
            return Object.assign(result, { orderBy: () => result })
          },
        }
        return builder
      },
    }),
  }
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder stand-in
  return { conn: conn as any, queries }
}

/** The column names any depth of a composed `and(...)` refers to. */
// biome-ignore lint/suspicious/noExplicitAny: walking drizzle's SQL chunk tree
function columnNames(node: any): string[] {
  if (!node) return []
  if (node.name && node.table) return [node.name]
  if (Array.isArray(node)) return node.flatMap(columnNames)
  if (node.queryChunks) return columnNames(node.queryChunks)
  return []
}

describe('findSystemRecordIdsByValue', () => {
  it('groups matching instance ids by the text they matched', async () => {
    const { conn, queries } = db([
      [
        { entityId: 'a', key: '4000' },
        { entityId: 'b', key: '4000' },
        { entityId: 'c', key: '4100' },
      ],
    ])

    const found = await findSystemRecordIdsByValue(conn, ORG, ctx, {
      attribute: 'code',
      text: ['4000', '4100'],
    })

    expect(queries).toHaveLength(1)
    expect([...found]).toEqual([
      ['4000', ['a', 'b']],
      ['4100', ['c']],
    ])
  })

  it('matches a relationship, an option and a number on their own columns', async () => {
    for (const [criterion, column] of [
      [{ attribute: 'order', related: ['o1'] }, 'relatedEntityId'],
      [{ attribute: 'status', option: ['draft'] }, 'optionId'],
      [{ attribute: 'amount', number: [-1250] }, 'valueNumber'],
    ] as const) {
      const { conn, queries } = db([[]])
      await findSystemRecordIdsByValue(conn, ORG, ctx, criterion)
      expect(columnNames(queries[0]?.joins[0])).toContain(column)
    }
  })

  it('keys a number match on its string form', async () => {
    const { conn } = db([[{ entityId: 'a', key: -1250 }]])

    const found = await findSystemRecordIdsByValue(conn, ORG, ctx, {
      attribute: 'amount',
      number: [-1250],
    })

    expect(found.get('-1250')).toEqual(['a'])
  })

  it('is live-only by default and includes archived only when asked', async () => {
    const live = db([[]])
    await findSystemRecordIdsByValue(live.conn, ORG, ctx, { attribute: 'code', text: ['4000'] })
    expect(columnNames(live.queries[0]?.where)).toContain('archivedAt')

    const all = db([[]])
    await findSystemRecordIdsByValue(
      all.conn,
      ORG,
      ctx,
      { attribute: 'code', text: ['4000'] },
      { includeArchived: true }
    )
    expect(columnNames(all.queries[0]?.where)).not.toContain('archivedAt')
  })

  it('scopes every read by the organization and the definition', async () => {
    const { conn, queries } = db([[]])
    await findSystemRecordIdsByValue(conn, ORG, ctx, { attribute: 'code', text: ['4000'] })
    const scope = columnNames(queries[0]?.where)
    expect(scope).toContain('organizationId')
    expect(scope).toContain('entityDefinitionId')
  })

  it('intersects composite criteria in SQL, one join each, keyed on the first', async () => {
    const { conn, queries } = db([[{ entityId: 'vp_1', key: 'sku-9' }]])

    const found = await findSystemRecordIdsByValue(conn, ORG, ctx, [
      { attribute: 'code', text: ['sku-9'] },
      { attribute: 'order', related: ['o1'] },
    ])

    expect(queries).toHaveLength(1)
    expect(queries[0]?.joins).toHaveLength(2)
    expect(found.get('sku-9')).toEqual(['vp_1'])
  })

  it('compares case-insensitively when asked, and keys on the lower-cased value', async () => {
    const { conn } = db([[{ entityId: 'p_1', key: 'm400l' }]])

    const found = await findSystemRecordIdsByValue(conn, ORG, ctx, {
      attribute: 'code',
      text: ['M400L'],
      caseInsensitive: true,
    })

    expect(found.get('m400l')).toEqual(['p_1'])
    expect(found.has('M400L')).toBe(false)
  })

  it('chunks past 200 values rather than sending one unbounded IN-list', async () => {
    const values = Array.from({ length: 401 }, (_, i) => `v-${i}`)
    const { conn, queries } = db([[], [], []])

    await findSystemRecordIdsByValue(conn, ORG, ctx, { attribute: 'code', text: values })

    expect(queries).toHaveLength(3)
  })

  it('issues no query at all for an empty value list or an unprovisioned field', async () => {
    const empty = db([])
    expect(
      await findSystemRecordIdsByValue(empty.conn, ORG, ctx, { attribute: 'code', text: [] })
    ).toEqual(new Map())
    expect(empty.queries).toHaveLength(0)

    const missing = db([])
    const short: SystemValueContext<Attribute> = { ...ctx, fields: { ...ctx.fields, code: null } }
    expect(
      await findSystemRecordIdsByValue(missing.conn, ORG, short, {
        attribute: 'code',
        text: ['4000'],
      })
    ).toEqual(new Map())
    expect(missing.queries).toHaveLength(0)
  })

  it('empties the whole conjunction when any criterion is unusable, never widening it', async () => {
    const { conn, queries } = db([])
    const short: SystemValueContext<Attribute> = { ...ctx, fields: { ...ctx.fields, order: null } }

    const found = await findSystemRecordIdsByValue(conn, ORG, short, [
      { attribute: 'code', text: ['sku-9'] },
      { attribute: 'order', related: ['o1'] },
    ])

    expect(found).toEqual(new Map())
    expect(queries).toHaveLength(0)
  })

  it('refuses a criterion that states no value column, or more than one', async () => {
    const { conn } = db([])
    // biome-ignore lint/suspicious/noExplicitAny: the shape the type already forbids
    const bad = { attribute: 'code' } as any
    await expect(findSystemRecordIdsByValue(conn, ORG, ctx, bad)).rejects.toThrow(
      'exactly one of text, related, option or number'
    )
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: same
      findSystemRecordIdsByValue(conn, ORG, ctx, {
        attribute: 'code',
        text: ['a'],
        option: ['b'],
      } as any)
    ).rejects.toThrow('exactly one of text, related, option or number')
  })

  it('dedupes the instance ids a multi-value field reports twice', async () => {
    const { conn } = db([
      [
        { entityId: 'a', key: '4000' },
        { entityId: 'a', key: '4000' },
      ],
    ])

    const found = await findSystemRecordIdsByValue(conn, ORG, ctx, {
      attribute: 'code',
      text: ['4000'],
    })

    expect(found.get('4000')).toEqual(['a'])
  })
})
