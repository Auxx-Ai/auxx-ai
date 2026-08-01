// packages/lib/src/data-migrations/describe-migration-error.test.ts

import { describe, expect, it } from 'vitest'
import { describeMigrationError, MAX_SUMMARY_LENGTH } from './describe-migration-error'

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
  return Object.assign(error, {
    code: fields.code,
    constraint: fields.constraint,
    detail: fields.detail,
    table: fields.table,
    column: fields.column,
  })
}

/** Drizzle's `DrizzleQueryError`: message is the SQL plus the BOUND PARAMS, pg error on `.cause`. */
function drizzleQueryError(query: string, params: unknown[], cause: Error): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params}`)
  error.name = 'DrizzleQueryError'
  return Object.assign(error, { query, params, cause })
}

describe('describeMigrationError', () => {
  it('unwraps a NESTED cause chain and reports the pg fields, not just the wrapper', () => {
    // Two hops down: our own wrapper → Drizzle → pg. This is the 069 shape.
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
    const error = new Error('Migration 069 failed for 1 org(s)', { cause: drizzle })

    const { summary, pg: fields } = describeMigrationError(error)

    // The actual cause, reachable only through two `.cause` hops.
    expect(fields).toEqual({
      code: '23503',
      constraint: 'Thread_inboxId_fkey',
      table: 'Thread',
      column: 'inboxId',
      detail: 'Key (inboxId)=(inb_123) is not present in table "Inbox".',
    })
    expect(summary).toContain('Migration 069 failed for 1 org(s)')
    expect(summary).toContain('code=23503')
    expect(summary).toContain('constraint=Thread_inboxId_fkey')
    expect(summary).toContain('table=Thread column=inboxId')
    expect(summary).toContain('violates foreign key constraint')
    // The SQL identifies the statement and is kept once.
    expect(summary).toContain('query: update "Thread" set "searchText" = $1')
  })

  it('never stores the bound query parameters', () => {
    const drizzle = drizzleQueryError(
      'insert into "Thread" ("searchText") values ($1)',
      ['ada@acme-supply.io wants a refund'],
      pgError({ message: 'value too long for type character varying(255)', code: '22001' })
    )

    const { summary } = describeMigrationError(drizzle)

    expect(summary).not.toContain('ada@acme-supply.io')
    expect(summary).not.toContain('params:')
    expect(summary).toContain('code=22001')
  })

  it('bounds what it stores even when the query and detail are enormous', () => {
    const hugeQuery = `insert into "Thread" values ${'(1,2,3),'.repeat(50_000)}`
    const drizzle = drizzleQueryError(
      hugeQuery,
      ['x'],
      pgError({
        message: 'duplicate key value violates unique constraint',
        code: '23505',
        constraint: 'Thread_pkey',
        detail: `Key (id)=(${'a'.repeat(5_000)}) already exists.`,
      })
    )

    const { summary, pg } = describeMigrationError(drizzle)

    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH)
    expect(summary).toContain('code=23505')
    expect(summary).toContain('…[truncated]')
    expect((pg.detail ?? '').length).toBeLessThanOrEqual(200)
  })

  it('collapses to a single line so the ledger row stays readable', () => {
    const drizzle = drizzleQueryError(
      'update "Thread"\n  set "searchText" = $1\n  where "id" = $2',
      ['x', 'y'],
      pgError({ message: 'column "searchText" does not exist', code: '42703' })
    )

    expect(describeMigrationError(drizzle).summary).not.toContain('\n')
  })

  it('falls back to the plain message when nothing on the chain is a pg error', () => {
    const { summary, pg } = describeMigrationError(new TypeError('orgId is not iterable'))

    expect(summary).toBe('TypeError: orgId is not iterable')
    expect(pg).toEqual({})
  })

  it('survives a cyclic cause chain', () => {
    const error = new Error('boom') as Error & { cause?: unknown }
    error.cause = error

    expect(describeMigrationError(error).summary).toBe('Error: boom')
  })

  it('handles non-Error throws', () => {
    expect(describeMigrationError('just a string').summary).toBe('just a string')
    expect(describeMigrationError(undefined).summary).toBe('Unknown migration failure: undefined')
  })

  it('reads pg fields off the outermost error when the driver error is not wrapped', () => {
    const { summary, pg } = describeMigrationError(
      pgError({
        message: 'null value in column "searchText" violates not-null constraint',
        code: '23502',
        table: 'Thread',
        column: 'searchText',
      })
    )

    expect(pg.code).toBe('23502')
    // No duplicated `cause:` part when the head IS the pg error.
    expect(summary).not.toContain('cause:')
    expect(summary).toContain('code=23502 table=Thread column=searchText')
  })

  it('ignores non-SQLSTATE `code` values like Node syscall errors', () => {
    const { pg } = describeMigrationError(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )

    expect(pg).toEqual({})
  })
})
