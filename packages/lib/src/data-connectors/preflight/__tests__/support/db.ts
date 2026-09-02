// packages/lib/src/data-connectors/preflight/__tests__/support/db.ts
// A recording, Drizzle-*shaped* database stub for the pre-flight's tests —
// scoped down from `packages/lib/src/files/__tests__/support/db.ts`'s fuller
// version (that one is private to `files/`; this module builds its own rather
// than reach across a sibling feature's test-only directory).
//
// This is a stub, not a Drizzle emulator: it hands back rows a test queued and
// records what was asked of it. `insert`/`update`/`delete` always throw — every
// caller in this module is read-only end to end, so a test that reaches one of
// these by accident should fail loudly, not silently succeed.

import type { Database } from '@auxx/database'

type Chain = PromiseLike<unknown[]> & Record<string, (...args: unknown[]) => unknown>

const CHAIN_METHODS = [
  'from',
  'where',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'orderBy',
  'groupBy',
  'limit',
  'offset',
] as const

function makeReadChain(resolve: () => unknown[]): Chain {
  const chain = {
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS thenable.
    then: (onFulfilled?: unknown, onRejected?: unknown) =>
      Promise.resolve()
        .then(() => resolve())
        .then(onFulfilled as (v: unknown[]) => unknown, onRejected as (e: unknown) => unknown),
  } as unknown as Chain
  for (const method of CHAIN_METHODS) {
    chain[method] = () => chain
  }
  return chain
}

/** Rows a test queues up for `db.query.<Table>.findFirst` / `db.select()`. */
export interface MakeFakeDbOptions {
  /** Results for `db.query.<Table>.findFirst`, keyed by table name, one per call. */
  queryFindFirst?: Record<string, unknown[]>
  /** Results for each awaited `db.select()...` chain, in call order. */
  select?: unknown[][]
}

export interface FakeDb {
  db: Database
  /** Every write attempted (`insert`/`update`/`delete`/raw `execute`), in call
   *  order. A live array reference — safe to destructure once and read after
   *  the fact. */
  writesAttempted: string[]
  /**
   * How many `select()` calls were made so far — the no-write assertion pairs
   * this with `writesAttempted.length === 0` to prove the module actually
   * read. A METHOD, not a captured number: `const { selectCalls } = makeFakeDb()`
   * would freeze a primitive at construction time, before the code under test
   * ever runs — call `selectCalls()` after awaiting, not before.
   */
  selectCalls: () => number
}

/** Build a read-only db stub for the pre-flight's tests. */
export function makeFakeDb(options: MakeFakeDbOptions = {}): FakeDb {
  const findFirstQueues = new Map<string, unknown[]>(
    Object.entries(options.queryFindFirst ?? {}).map(([table, rows]) => [table, [...rows]])
  )
  const selectQueue = [...(options.select ?? [])]
  let selectCallCount = 0

  const fake: FakeDb = {
    db: undefined as unknown as Database,
    writesAttempted: [],
    selectCalls: () => selectCallCount,
  }

  const refuseWrite = (op: string): never => {
    fake.writesAttempted.push(op)
    throw new Error(
      `unexpected ${op} — the duplicate-SKU pre-flight (plans/money/design/duplicate-sku-preflight.md ` +
        '§5 "it must not write") must never touch insert/update/delete'
    )
  }

  const surface: Record<string, unknown> = {
    query: new Proxy(
      {},
      {
        get: (_target, tableKey: string) => ({
          findFirst: async () => findFirstQueues.get(tableKey)?.shift(),
          findMany: async () => findFirstQueues.get(tableKey)?.shift() ?? [],
        }),
      }
    ),
    select: () => {
      selectCallCount += 1
      return makeReadChain(() => selectQueue.shift() ?? [])
    },
    insert: () => refuseWrite('insert'),
    update: () => refuseWrite('update'),
    delete: () => refuseWrite('delete'),
    execute: () => refuseWrite('execute'),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(surface),
  }

  fake.db = surface as unknown as Database
  return fake
}
