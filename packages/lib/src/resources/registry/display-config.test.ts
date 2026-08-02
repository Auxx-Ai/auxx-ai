// packages/lib/src/resources/registry/display-config.test.ts
//
// Registry integrity: every column name a `RESOURCE_DISPLAY_CONFIG` entry
// mentions must actually exist on the table that entry resolves to.
//
// ## Why this file exists
//
// `RESOURCE_DISPLAY_CONFIG` is a bag of STRINGS. Nothing in the type system ties
// `searchFields: ['name', 'email']` to the Drizzle table the entry is served
// from, so a config could — and did, from the repo's initial commit — name a
// column that has never existed. `participant` declared `email` as both its
// secondary display field and a search field while `Participant` has only
// `identifier` / `identifierType`. The consequences were spread across three
// lanes and all three were quiet:
//
//   - `searchGlobalUnion` catches per-kind failures and logs them, so the
//     participant leg contributed ZERO rows to every global search for months;
//   - scoped `record.search({ entityDefinitionId: 'participant' })` threw
//     uncaught — a 500 reading `Unknown column 'email' on table 'undefined'`
//     (the `'undefined'` is `getTableName` on Drizzle's relational-query fields
//     bag, which carries no table-name symbol — it is NOT a table that failed to
//     resolve, and it misdirected the diagnosis for a long time);
//   - the by-ids hydration path silently produced `secondaryInfo: undefined`.
//
// One assertion per column reference is all it took to catch it, and this guards
// the other legs of the same union.
//
// ## Reading the real schema under Vitest
//
// ⚠ `src/test/setup.ts` mocks `@auxx/database` with a Proxy that hands back `{}`
// for every table, so `schema.Participant.identifier` is `undefined` under the
// normal import — column-level introspection is impossible through it, and a
// test written against the mock would report EVERY column as missing (or, if
// inverted to compensate, would pass vacuously forever).
//
// So the real tables are pulled in with `vi.importActual` on the schema barrel
// **directly**, not on `@auxx/database`: the package index also evaluates
// `db/client`, whose top-level `createDatabase()` opens a `pg.Pool` at import.
// The barrel is pure table declarations. The shared setup mock is left entirely
// alone — nothing here re-mocks `@auxx/database`, `@auxx/logger` or
// `drizzle-orm`.
//
// {@link REAL_COLUMNS_ARE_VISIBLE} is the anti-vacuity guard: if the import ever
// silently degrades back to the `{}` mock, that test fails first and says so,
// rather than letting every `for` loop below iterate over nothing.

import { Column, is } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RESOURCE_DISPLAY_CONFIG } from './display-config'
import { RESOURCE_TABLE_MAP, type TableId } from './field-registry'

let realSchema: Record<string, unknown>

beforeAll(async () => {
  realSchema = await vi.importActual<Record<string, unknown>>('@auxx/database/db/schema')
})

/**
 * The column names on a real Drizzle table, or `undefined` when `dbName` names
 * no table in the schema.
 *
 * `is(value, Column)` rather than a truthy property check: a Drizzle table also
 * carries non-column members (`enableRLS`, symbols), and a display config naming
 * one of those would resolve truthily through `requireColumn` and then build
 * nonsense SQL. This is strictly stricter than the runtime it guards.
 */
function columnsOf(dbName: string): Set<string> | undefined {
  const table = realSchema[dbName]
  if (!table || typeof table !== 'object') return undefined
  const columns = new Set<string>()
  for (const [key, value] of Object.entries(table)) {
    if (is(value, Column)) columns.add(key)
  }
  return columns.size > 0 ? columns : undefined
}

/**
 * Display-config entries served from a REAL table, paired with that table's
 * column set.
 *
 * Entries are skipped when the resource has no `RESOURCE_TABLE_MAP` row
 * (`ticket` / `contact` / `part` / `inbox` / `personal_inbox` are
 * EntityDefinition-backed, so `RESOURCE_TABLE_REGISTRY` excludes them) or when
 * its `dbName` names no table (those rows live in `EntityInstance`). Skipping is
 * only safe because {@link COVERED_TABLES} pins what must survive the filter.
 */
function coveredEntries(): Array<{
  tableId: TableId
  dbName: string
  columns: Set<string>
}> {
  const covered: Array<{ tableId: TableId; dbName: string; columns: Set<string> }> = []
  for (const tableId of Object.keys(RESOURCE_DISPLAY_CONFIG) as TableId[]) {
    const dbName = RESOURCE_TABLE_MAP[tableId]?.dbName
    if (!dbName) continue
    const columns = columnsOf(dbName)
    if (!columns) continue
    covered.push({ tableId, dbName, columns })
  }
  return covered
}

/**
 * The resources this file MUST be checking. Every one is a leg of the
 * `searchGlobalUnion` fan-out or a mail table reached by id, and every one is
 * served by `fetchResourcesDirect` / `fetchResourcesWithJoin`, which pass these
 * config strings straight to `requireColumn`.
 *
 * Hard-coded on purpose. Without it, a regression that broke the schema import
 * or renamed a `dbName` would empty `coveredEntries()` and turn every assertion
 * below into a no-op loop — the exact failure mode this file is meant to prevent.
 */
const COVERED_TABLES: TableId[] = [
  'user',
  'participant',
  'dataset',
  'article',
  'kb',
  'visit',
  'thread',
  'message',
]

/**
 * Column references that are KNOWN to be broken and are deliberately not fixed
 * here, keyed `tableId` → the `columnRefs` labels to exempt.
 *
 * **This list must shrink, never grow.** Each entry is asserted to be genuinely
 * still missing (see the "known defects are still defects" test), so fixing the
 * underlying config without deleting its exemption fails the suite rather than
 * quietly leaving a stale waiver behind.
 *
 * `message.searchFields[1] = 'from'` — `Message` has `fromId` (an FK to
 * `Participant`), not `from`; `from` is a RELATION name, and `searchFields` are
 * fed to `ilike(requireColumn(...))`, which a relation can never satisfy. It is
 * inert today only because `message` is an {@link
 * import('../picker/mail-lens-tables').isMailLensTableId} table, so
 * `fetchResourcesFromDb` throws the mail-lens refusal BEFORE `requireColumn` is
 * reached — the day `message` leaves that set, this becomes the participant bug
 * again. Left alone here because a mail table's display semantics are a mail
 * decision, not a drive-by edit.
 */
const KNOWN_BAD: Partial<Record<TableId, string[]>> = {
  message: ["searchFields[1]: 'from'"],
}

/** Every config key whose value is a column name on the entry's own table. */
function columnRefs(tableId: TableId): Array<{ where: string; column: string }> {
  const config = RESOURCE_DISPLAY_CONFIG[tableId]
  if (!config) return []
  const refs: Array<{ where: string; column: string }> = []
  const push = (where: string, column: string | undefined) => {
    if (column) refs.push({ where, column })
  }

  push('identifierField', config.identifierField)
  push('primaryDisplayFieldId', config.primaryDisplayFieldId)
  push('secondaryDisplayFieldId', config.secondaryDisplayFieldId)
  push('avatarFieldId', config.avatarFieldId)
  push('iconFieldId', config.iconFieldId)
  push('colorFieldId', config.colorFieldId)
  // `fetchResourcesDirect` sorts with `requireColumn(table, sortField)`, so a bad
  // sort field throws on EVERY read of the table, not just a searched one.
  push('defaultSortField', config.defaultSortField)
  config.searchFields.forEach((field, i) => push(`searchFields[${i}]`, field))
  for (const key of Object.keys(config.neverPickable ?? {})) {
    push(`neverPickable['${key}']`, key)
  }
  return refs
}

describe('RESOURCE_DISPLAY_CONFIG column integrity', () => {
  it('REAL_COLUMNS_ARE_VISIBLE: the schema import is not the `{}` setup mock', () => {
    // If this fails, every other test in this file is vacuous — fix the import
    // before trusting a green run.
    const participant = columnsOf('Participant')
    expect(participant).toBeDefined()
    expect([...participant!].sort()).toEqual(
      [
        'createdAt',
        'displayName',
        'entityInstanceId',
        'firstInteractionDate',
        'firstInteractionType',
        'hasReceivedMessage',
        'id',
        'identifier',
        'identifierType',
        'initials',
        'isInternal',
        'isSpammer',
        'lastSentMessageAt',
        'name',
        'organizationId',
        'updatedAt',
      ].sort()
    )
    // The original bug, pinned from both sides: `email` is absent and
    // `identifier` is what actually holds the address.
    expect(participant!.has('email')).toBe(false)
    expect(participant!.has('identifier')).toBe(true)
  })

  it('covers every union leg — the skip filter has not swallowed the suite', () => {
    const coveredIds = coveredEntries().map((entry) => entry.tableId)
    for (const tableId of COVERED_TABLES) {
      expect(coveredIds).toContain(tableId)
    }
  })

  it.each(COVERED_TABLES)('%s names only real columns', (tableId) => {
    const dbName = RESOURCE_TABLE_MAP[tableId]?.dbName
    expect(dbName).toBeTruthy()
    const columns = columnsOf(dbName!)
    expect(columns).toBeDefined()

    const exempt = new Set(KNOWN_BAD[tableId] ?? [])
    const missing = columnRefs(tableId)
      .filter((ref) => !columns!.has(ref.column))
      .map((ref) => `${ref.where}: '${ref.column}'`)
      .filter((label) => !exempt.has(label))

    expect(missing).toEqual([])
  })

  it('known defects are still defects — no stale waivers in KNOWN_BAD', () => {
    for (const [tableId, labels] of Object.entries(KNOWN_BAD) as Array<[TableId, string[]]>) {
      const columns = columnsOf(RESOURCE_TABLE_MAP[tableId]!.dbName)
      const stillMissing = columnRefs(tableId)
        .filter((ref) => !columns!.has(ref.column))
        .map((ref) => `${ref.where}: '${ref.column}'`)
      for (const label of labels) {
        expect(
          stillMissing,
          `KNOWN_BAD['${tableId}'] lists "${label}", which now resolves — delete the waiver`
        ).toContain(label)
      }
    }
  })

  it('join-scoped entries reference real columns on both tables', () => {
    for (const { tableId, columns } of coveredEntries()) {
      const join = RESOURCE_DISPLAY_CONFIG[tableId]?.joinScoping
      if (!join) continue
      const joinColumns = columnsOf(join.joinTable)
      expect(joinColumns, `${tableId}: join table '${join.joinTable}'`).toBeDefined()

      // `fetchResourcesWithJoin` passes each of these to `requireColumn`.
      expect(columns.has(join.mainTableKey), `${tableId}.mainTableKey`).toBe(true)
      expect(joinColumns!.has(join.joinSourceKey), `${tableId}.joinSourceKey`).toBe(true)
      expect(joinColumns!.has(join.joinOrgKey), `${tableId}.joinOrgKey`).toBe(true)
      for (const key of Object.keys(join.additionalConditions ?? {})) {
        expect(columns.has(key), `${tableId}.additionalConditions['${key}']`).toBe(true)
      }
    }
  })
})
