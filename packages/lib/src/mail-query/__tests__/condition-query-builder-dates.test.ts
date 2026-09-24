// packages/lib/src/mail-query/__tests__/condition-query-builder-dates.test.ts
//
// The shared schema mock leaves `Thread`'s date columns undefined, so every date
// operator drops in `condition-query-builder.test.ts`. This file pins a real
// `Thread` table to exercise the date column path.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { ConditionGroup } from '../../conditions/types'
import type { UserInstanceGrants } from '../../permissions/visibility/context'
import { buildConditionGroupsQueryWithDiagnostics } from '../condition-query-builder'

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core')

  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Thread: pgTable('Thread', {
        id: text('id').primaryKey(),
        organizationId: text('organizationId'),
        mergedIntoThreadId: text('mergedIntoThreadId'),
        lastMessageAt: timestamp('lastMessageAt'),
        firstMessageAt: timestamp('firstMessageAt'),
        createdAt: timestamp('createdAt'),
        closedAt: timestamp('closedAt'),
      }),
    }),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

const viewer = {
  userId: 'user-1',
  role: 'USER',
  isAdmin: true,
  isMailAdmin: true,
  inboxLens: {},
  personalInboxIds: {},
  grants: {},
  defEntityTypes: {},
} as unknown as UserInstanceGrants

function buildDate(operator: string, value: unknown) {
  const groups: ConditionGroup[] = [
    {
      id: 'g1',
      logicalOperator: 'AND',
      conditions: [
        { id: 'c1', fieldId: 'date', operator, value } as ConditionGroup['conditions'][number],
      ],
    },
  ]
  return buildConditionGroupsQueryWithDiagnostics(groups, 'organization-1', viewer)
}

describe('date — between', () => {
  it('compiles a closed range to >= from AND < to on lastMessageAt', () => {
    const result = buildDate('between', {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    })

    expect(result.droppedConditions).toEqual([])
    const sql = new PgDialect().sqlToQuery(result.sql).sql
    expect(sql).toContain('"Thread"."lastMessageAt" >= $')
    expect(sql).toContain('"Thread"."lastMessageAt" < $')
  })

  it('compiles a one-sided range to its one bound', () => {
    const sql = new PgDialect().sqlToQuery(buildDate('between', { to: '2026-09-01' }).sql).sql
    expect(sql).toContain('"Thread"."lastMessageAt" < $')
    expect(sql).not.toContain('"Thread"."lastMessageAt" >= $')
  })

  it('drops an unparseable range instead of matching everything', () => {
    expect(buildDate('between', { from: 'not-a-date' }).allConditionsDropped).toBe(true)
  })
})
