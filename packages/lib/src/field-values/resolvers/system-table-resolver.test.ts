// packages/lib/src/field-values/resolvers/system-table-resolver.test.ts

import { FieldType } from '@auxx/database/enums'
import type { ResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldValueContext } from '../field-value-helpers'
import type { SystemFieldDescriptor } from './system-table-resolver'

/** Replace the org cache with deterministic actor records for resolver tests. */
const { getCachedMembersByUserIds } = vi.hoisted(() => ({
  getCachedMembersByUserIds: vi.fn(),
}))

vi.mock('../../cache', () => ({ getCachedMembersByUserIds }))
vi.mock('@auxx/database', () => ({
  schema: {
    WorkOrderVisit: { id: {}, organizationId: {}, assigneeUserId: {} },
    Thread: { id: {}, organizationId: {}, assigneeUserId: {} },
  },
}))

import { resolveSystemTableFields } from './system-table-resolver'

/** Build the minimal query-chain double used by the system-table resolver. */
function createDatabase(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  }
}

/** Build a field-value context with the supplied system-table rows. */
function createContext(rows: unknown[]): FieldValueContext {
  return {
    db: createDatabase(rows) as unknown as FieldValueContext['db'],
    organizationId: 'org_123',
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
  }
}

/** Build an ACTOR descriptor backed by a system-table user-id column. */
function actorField(entityType: string): SystemFieldDescriptor {
  return {
    fieldKey: 'assignee',
    fieldId: 'assignee-field',
    fieldRef: `${entityType}:assignee` as ResourceFieldId,
    fieldType: FieldType.ACTOR,
    fieldOptions: { actor: { target: 'user', multiple: false } },
    dbColumn: 'assigneeUserId',
  }
}

describe('resolveSystemTableFields actor hydration', () => {
  beforeEach(() => {
    getCachedMembersByUserIds.mockReset()
  })

  it('uses the cached member name for a Visit actor field', async () => {
    getCachedMembersByUserIds.mockResolvedValue([
      { userId: 'user_123', user: { name: 'Jordan Lee' } },
    ])

    const results = await resolveSystemTableFields(
      createContext([{ id: 'visit_123', assignee: 'user_123' }]),
      'visit',
      ['visit_123'],
      [actorField('visit')]
    )

    expect(results[0]?.value).toMatchObject({
      type: 'actor',
      actorId: 'user:user_123',
      displayName: 'Jordan Lee',
    })
    expect(getCachedMembersByUserIds).toHaveBeenCalledWith('org_123', ['user_123'])
  })

  it('leaves a deleted or missing actor unnamed so the placeholder fallback can apply', async () => {
    getCachedMembersByUserIds.mockResolvedValue([])

    const results = await resolveSystemTableFields(
      createContext([{ id: 'visit_123', assignee: 'user_deleted' }]),
      'visit',
      ['visit_123'],
      [actorField('visit')]
    )

    expect(results[0]?.value).toMatchObject({ type: 'actor', actorId: 'user:user_deleted' })
    expect(results[0]?.value).not.toHaveProperty('displayName')
  })

  it('hydrates actor fields for every system resource, not only Visit', async () => {
    getCachedMembersByUserIds.mockResolvedValue([
      { userId: 'user_456', user: { name: 'Morgan Yu' } },
    ])

    const results = await resolveSystemTableFields(
      createContext([{ id: 'thread_123', assignee: 'user_456' }]),
      'thread',
      ['thread_123'],
      [actorField('thread')]
    )

    expect(results[0]?.value).toMatchObject({
      type: 'actor',
      actorId: 'user:user_456',
      displayName: 'Morgan Yu',
    })
  })
})
