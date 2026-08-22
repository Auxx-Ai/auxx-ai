// packages/lib/src/files/__tests__/support/db.ts

/**
 * A recording, Drizzle-*shaped* database stub — and the shared journal that
 * makes cross-collaborator ordering assertable.
 *
 * **This is a stub, not a Drizzle emulator.** It records the calls made against
 * it and returns rows the test queued, in call order. It deliberately does not
 * look at a `where` clause, a `limit`, or a join: the moment a test needs the
 * fake to *interpret* SQL, that test wants a pure function or a real database
 * instead, and pretending otherwise produces a fake that passes while the query
 * is wrong. Keep it dumb.
 */

import type { Database, Transaction } from '@auxx/database'

// ============= Journal =============

/** Which collaborator produced an entry. `db` covers BEGIN/COMMIT as well as statements. */
export type JournalChannel = 'db' | 'storage' | 'queue' | 'cache'

/** One recorded interaction, stamped with a monotonic sequence number. */
export interface JournalEntry {
  seq: number
  channel: JournalChannel
  op: string
  detail?: Record<string, unknown>
}

/**
 * A single monotonic recorder shared by the db stub and the port doubles.
 *
 * This exists for one assertion the refactor turns on: *no storage call, queue
 * write or cache bust may happen between `BEGIN` and `COMMIT`*. That question is
 * unanswerable if each double keeps its own call list, because there is nothing
 * to interleave them by. Hand the same journal to every double in a test and
 * {@link Journal.between} answers it directly.
 */
export interface Journal {
  /** Every entry, in the order it happened. */
  readonly entries: JournalEntry[]
  /** Append an entry and return it. Doubles call this; tests normally read instead. */
  record(channel: JournalChannel, op: string, detail?: Record<string, unknown>): JournalEntry
  /** The `op` strings, optionally narrowed to one channel — the readable form for `toEqual`. */
  ops(channel?: JournalChannel): string[]
  /** Entries strictly between the first `from` and the first `to` that follows it. */
  between(from: string, to: string): JournalEntry[]
  /** Drop everything recorded so far. */
  reset(): void
}

/** Create a journal. Pass the same instance to `makeDb`, `makeStoragePort`, `makeQueuePort`, `makeCachePort`. */
export function makeJournal(): Journal {
  const entries: JournalEntry[] = []
  let seq = 0

  return {
    entries,
    record(channel, op, detail) {
      seq += 1
      const entry: JournalEntry = { seq, channel, op, ...(detail && { detail }) }
      entries.push(entry)
      return entry
    },
    ops(channel) {
      return entries.filter((e) => !channel || e.channel === channel).map((e) => e.op)
    },
    between(from, to) {
      const start = entries.findIndex((e) => e.op === from)
      if (start === -1) return []
      const end = entries.findIndex((e, i) => i > start && e.op === to)
      return entries.slice(start + 1, end === -1 ? entries.length : end)
    },
    reset() {
      entries.length = 0
      seq = 0
    },
  }
}

// ============= The repo gotcha =============

/**
 * Best-effort name for a Drizzle table reference.
 *
 * Under Vitest this package's setup replaces `@auxx/database`'s `schema` with a
 * memoised proxy handing out bare `{}` objects, so `schema.MediaAsset._.name` is
 * `undefined` and the table cannot name itself. Identity is still stable, which
 * is why {@link MakeDbOptions.tables} exists — register the tables a test cares
 * about and the journal carries real names instead of `'table'`.
 *
 * Lives here once so no `files/` test has to re-derive it (the reference test
 * `snippets/__tests__/snippet-folder-mutations.test.ts` carries a local copy).
 */
export function tableName(table: unknown, registry?: ReadonlyMap<unknown, string>): string {
  if (table === undefined || table === null) return 'unknown'
  const registered = registry?.get(table)
  if (registered) return registered
  const named = (table as { _?: { name?: unknown } })._?.name
  return typeof named === 'string' ? named : 'table'
}

// ============= The db stub =============

/**
 * Rows a test queues up, per surface. Each entry is consumed by one call, in
 * order; running out yields `undefined` (relational) or `[]` (builder chains),
 * which is what a real miss looks like.
 */
export interface MakeDbOptions {
  /** Results for `db.query.<Table>.findFirst` / `.findMany`, keyed by table name. */
  query?: Record<string, unknown[]>
  /** Results for each awaited `db.select()` chain, in call order. */
  select?: unknown[][]
  /** Results for each awaited `db.insert()` chain. Defaults to the inserted values. */
  insert?: unknown[][]
  /** Results for each awaited `db.update()` chain. Defaults to the `set` payload. */
  update?: unknown[][]
  /** Results for each awaited `db.delete()` chain. Defaults to `[]`. */
  delete?: unknown[][]
  /** Register real table references so journal entries carry names, not `'table'`. */
  tables?: Record<string, unknown>
  /** Share ordering with the port doubles. One is created if omitted. */
  journal?: Journal
}

/** What a test asserts against after driving the code under test. */
export interface FakeDb {
  /** Pass this as `FilesCtx.db`. */
  db: Database
  journal: Journal
  inserts: Array<{ table: string; values: unknown }>
  updates: Array<{ table: string; values: unknown }>
  deletes: Array<{ table: string }>
  /**
   * The `where(...)` predicate handed to each `select` / `update` / `delete`
   * chain, in call order.
   *
   * The stub still does not *interpret* the clause — it stores the Drizzle `SQL`
   * object so a test can compare it to one it builds itself with the same
   * `and`/`eq`/`isNull`. That is how an organization-scope filter gets asserted
   * without a real database: `expect(db.wheres[0]?.predicate).toEqual(and(...))`.
   *
   * **What it cannot tell you:** which *column* each condition names. This
   * package's `@auxx/database` mock hands out `{}` for every table, so
   * `schema.Foo.bar` is `undefined` and every column renders identically. The
   * bound values, the operators and their order are all real; the column names
   * are not. A test that turns on column identity needs the integration lane.
   *
   * Deliberately not journalled — adding a `where` op would break every existing
   * `journal.ops()` assertion for no gain, since the ordering of a clause
   * relative to its own statement is not in question.
   */
  wheres: Array<{ table: string; predicate: unknown }>
  /** How many `db.transaction(...)` calls were opened, including nested ones. */
  transactions: number
}

type Chain = PromiseLike<unknown[]> & Record<string, (...args: unknown[]) => unknown>

/** Builder methods that just return the chain. Awaiting anywhere resolves the queued rows. */
const CHAIN_METHODS = [
  'from',
  'where',
  'orderBy',
  'groupBy',
  'having',
  'limit',
  'offset',
  'for',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'onConflictDoNothing',
  'onConflictDoUpdate',
  'returning',
  'prepare',
  'execute',
  'as',
] as const

function makeChain(
  resolve: () => unknown[],
  onCall?: (method: string, arg: unknown) => void
): Chain {
  const chain = {
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS thenable — `await db.select().from(t).where(w)` is the shape every call site uses, so the stub has to be too.
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      Promise.resolve()
        .then(() => resolve())
        .then(onFulfilled as (v: unknown[]) => unknown, onRejected as (e: unknown) => unknown),
  } as unknown as Chain
  for (const method of CHAIN_METHODS) {
    chain[method] = (...args: unknown[]) => {
      onCall?.(method, args[0])
      return chain
    }
  }
  return chain
}

/**
 * Build a db stub that records what was asked of it and hands back queued rows.
 *
 * `db.transaction(cb)` records `begin` then `commit` (or `rollback` if `cb`
 * throws) on the journal, and hands `cb` the same recording surface — so the
 * "nothing but SQL between BEGIN and COMMIT" assertion is a one-liner.
 */
export function makeDb(options: MakeDbOptions = {}): FakeDb {
  const journal = options.journal ?? makeJournal()
  const registry = new Map<unknown, string>(
    Object.entries(options.tables ?? {}).map(([name, ref]) => [ref, name])
  )

  const queryQueues = new Map<string, unknown[]>(
    Object.entries(options.query ?? {}).map(([table, rows]) => [table, [...rows]])
  )
  const selectQueue = [...(options.select ?? [])]
  const insertQueue = [...(options.insert ?? [])]
  const updateQueue = [...(options.update ?? [])]
  const deleteQueue = [...(options.delete ?? [])]

  const fake: FakeDb = {
    db: undefined as unknown as Database,
    journal,
    inserts: [],
    updates: [],
    deletes: [],
    wheres: [],
    transactions: 0,
  }

  const name = (table: unknown) => tableName(table, registry)

  function buildSurface(): Record<string, unknown> {
    const surface: Record<string, unknown> = {
      query: new Proxy(
        {},
        {
          get: (_target, tableKey: string) => ({
            findFirst: async (...args: unknown[]) => {
              journal.record('db', 'query.findFirst', { table: tableKey, args: args[0] })
              return queryQueues.get(tableKey)?.shift()
            },
            findMany: async (...args: unknown[]) => {
              journal.record('db', 'query.findMany', { table: tableKey, args: args[0] })
              return queryQueues.get(tableKey)?.shift() ?? []
            },
          }),
        }
      ),

      select: (...args: unknown[]) => {
        journal.record('db', 'select', { projection: args[0] })
        // The table arrives on `.from(t)`, not on `select()`, so it is captured
        // as the chain runs and read back when `.where(...)` lands.
        let from = 'unknown'
        return makeChain(
          () => selectQueue.shift() ?? [],
          (method, arg) => {
            if (method === 'from') from = name(arg)
            if (method === 'where') fake.wheres.push({ table: from, predicate: arg })
          }
        )
      },

      insert: (table: unknown) => {
        let lastInsertValues: unknown[] = []
        const chain = makeChain(() => insertQueue.shift() ?? lastInsertValues)
        chain.values = (values: unknown) => {
          journal.record('db', 'insert', { table: name(table) })
          fake.inserts.push({ table: name(table), values })
          lastInsertValues = Array.isArray(values) ? values : [values]
          return chain
        }
        return chain
      },

      update: (table: unknown) => {
        let lastSetPayload: unknown[] = []
        const chain = makeChain(
          () => updateQueue.shift() ?? lastSetPayload,
          (method, arg) => {
            if (method === 'where') fake.wheres.push({ table: name(table), predicate: arg })
          }
        )
        chain.set = (values: unknown) => {
          journal.record('db', 'update', { table: name(table) })
          fake.updates.push({ table: name(table), values })
          lastSetPayload = [values]
          return chain
        }
        return chain
      },

      delete: (table: unknown) => {
        journal.record('db', 'delete', { table: name(table) })
        fake.deletes.push({ table: name(table) })
        return makeChain(
          () => deleteQueue.shift() ?? [],
          (method, arg) => {
            if (method === 'where') fake.wheres.push({ table: name(table), predicate: arg })
          }
        )
      },

      execute: (...args: unknown[]) => {
        journal.record('db', 'execute', { sql: args[0] })
        return makeChain(() => [])
      },
    }

    surface.transaction = async (cb: (tx: Transaction) => Promise<unknown>) => {
      fake.transactions += 1
      journal.record('db', 'begin')
      try {
        const result = await cb(buildSurface() as unknown as Transaction)
        journal.record('db', 'commit')
        return result
      } catch (error) {
        journal.record('db', 'rollback')
        throw error
      }
    }

    return surface
  }

  fake.db = buildSurface() as unknown as Database
  return fake
}
