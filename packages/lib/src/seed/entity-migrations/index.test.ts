// packages/lib/src/seed/entity-migrations/index.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  describeMigrationError,
  MAX_SUMMARY_LENGTH,
} from '../../data-migrations/describe-migration-error'
import { runEntityMigrationForAllOrgs } from './index'
import type { EntityMigration } from './types'

/** A `node-postgres` `DatabaseError` as it actually arrives (name is lowercase 'error'). */
function pgError(fields: {
  message: string
  code?: string
  constraint?: string
  detail?: string
  table?: string
  column?: string
}): Error {
  const error = new Error(fields.message)
  error.name = 'error'
  return Object.assign(error, fields)
}

/** Drizzle's `DrizzleQueryError`: message is the SQL plus the BOUND PARAMS, pg error on `.cause`. */
function drizzleQueryError(query: string, params: unknown[], cause: Error): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params}`)
  error.name = 'DrizzleQueryError'
  return Object.assign(error, { query, params, cause })
}

/** Only `select().from(Organization)` is exercised by the runner. */
function dbWithOrgs(ids: string[]): Database {
  return {
    select: () => ({ from: async () => ids.map((id) => ({ id })) }),
  } as unknown as Database
}

function migrationThatThrows(thrown: (organizationId: string) => unknown): EntityMigration {
  return {
    id: '069-thread-search-text',
    description: 'test migration',
    up: async (_db, organizationId) => {
      throw thrown(organizationId)
    },
  }
}

async function runAndCatch(db: Database, migration: EntityMigration): Promise<Error> {
  try {
    await runEntityMigrationForAllOrgs(db, migration)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected runEntityMigrationForAllOrgs to throw')
}

describe('runEntityMigrationForAllOrgs failure reporting', () => {
  /**
   * The whole point of the fix: `wrapEntityMigration` hands this aggregate straight
   * to `runPendingDataMigrations`, which re-describes it for the ledger. A causeless
   * `new Error(...)` severs the chain here, so the runner's unwrapping recovers
   * nothing for any of the ~50 wrapped entity migrations.
   */
  it('keeps a pg error thrown inside one org identifiable through the aggregate', async () => {
    const pg = pgError({
      message: 'insert or update on table "Thread" violates foreign key constraint',
      code: '23503',
      constraint: 'Thread_inboxId_fkey',
      table: 'Thread',
      column: 'inboxId',
      detail: 'Key (inboxId)=(inb_123) is not present in table "Inbox".',
    })
    const drizzle = drizzleQueryError(
      'update "Thread" set "searchText" = $1 where "Thread"."id" = $2',
      ['ada@acme-supply.io order refund', 'thr_123'],
      pg
    )

    const aggregate = await runAndCatch(
      dbWithOrgs(['org_1']),
      migrationThatThrows(() => drizzle)
    )

    // The raw error object is still on the chain, one hop down.
    expect(aggregate.cause).toBe(drizzle)

    // …so the chain-walker the data-migration runner uses reaches the pg fields.
    const { summary, pg: fields } = describeMigrationError(aggregate)
    expect(fields).toEqual({
      code: '23503',
      constraint: 'Thread_inboxId_fkey',
      table: 'Thread',
      column: 'inboxId',
      detail: 'Key (inboxId)=(inb_123) is not present in table "Inbox".',
    })
    expect(summary).toContain('code=23503')
    expect(summary).toContain('constraint=Thread_inboxId_fkey')
  })

  it('names the pg error in the per-org line instead of the Drizzle wrapper', async () => {
    const drizzle = drizzleQueryError(
      'insert into "Thread" ("searchText") values ($1)',
      ['ada@acme-supply.io wants a refund'],
      pgError({ message: 'value too long for type character varying(255)', code: '22001' })
    )

    const aggregate = await runAndCatch(
      dbWithOrgs(['org_1']),
      migrationThatThrows(() => drizzle)
    )

    expect(aggregate.message).toContain('org_1: ')
    expect(aggregate.message).toContain('code=22001')
    expect(aggregate.message).toContain('value too long')
    // Bound query parameters are customer data and are never stored or logged.
    expect(aggregate.message).not.toContain('params:')
    expect(aggregate.message).not.toContain('ada@acme-supply.io')
  })

  it('quotes only the first few orgs and counts the rest', async () => {
    const orgs = Array.from({ length: 50 }, (_, i) => `org_${i}`)

    const aggregate = await runAndCatch(
      dbWithOrgs(orgs),
      migrationThatThrows((organizationId) => new Error(`boom in ${organizationId}`))
    )

    expect(aggregate.message).toContain('failed for 50 org(s)')
    expect(aggregate.message).toContain('org_0: ')
    expect(aggregate.message).toContain('org_4: ')
    expect(aggregate.message).not.toContain('org_5: ')
    expect(aggregate.message).toContain('…and 45 more org(s)')
  })

  it('bounds the aggregate no matter how many orgs fail or how big each error is', async () => {
    const orgs = Array.from({ length: 50 }, (_, i) => `org_${i}`)
    const hugeQuery = `insert into "Thread" values ${'(1,2,3),'.repeat(50_000)}`

    const aggregate = await runAndCatch(
      dbWithOrgs(orgs),
      migrationThatThrows(() =>
        drizzleQueryError(
          hugeQuery,
          ['x'],
          pgError({
            message: 'duplicate key value violates unique constraint',
            code: '23505',
            constraint: 'Thread_pkey',
          })
        )
      )
    )

    expect(aggregate.message.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH)
    // The count sits in the header, ahead of the truncation point.
    expect(aggregate.message).toContain('failed for 50 org(s)')
    expect(aggregate.message).toContain('code=23505')
    // And the ledger summary derived from it stays bounded too.
    expect(describeMigrationError(aggregate).summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH)
  })

  it('does not throw when every org succeeds', async () => {
    const migration: EntityMigration = {
      id: '069-thread-search-text',
      description: 'test migration',
      up: async () => ({
        entityDefsCreated: 0,
        fieldsCreated: 0,
        relationshipsLinked: 0,
        alreadyUpToDate: true,
      }),
    }

    await expect(
      runEntityMigrationForAllOrgs(dbWithOrgs(['org_1', 'org_2']), migration)
    ).resolves.toBeUndefined()
  })
})
