// packages/lib/src/field-values/resolvers/system-table-resolver.test.ts

import { FieldType } from '@auxx/database/enums'
import type { ResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldValueContext } from '../field-value-helpers'
import type { SystemFieldDescriptor } from './system-table-resolver'

/** Replace the org cache with deterministic actor records for resolver tests. */
const { getCachedMembersByUserIds, getCachedAgentsByUserIds, getOrgCache } = vi.hoisted(() => ({
  getCachedMembersByUserIds: vi.fn(),
  getCachedAgentsByUserIds: vi.fn(),
  getOrgCache: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getCachedMembersByUserIds,
  getCachedAgentsByUserIds,
  getOrgCache,
}))
vi.mock('@auxx/database', () => ({
  schema: {
    WorkOrderVisit: { id: {}, organizationId: {}, assigneeUserId: {} },
    Thread: { id: {}, organizationId: {}, assigneeUserId: {} },
    User: { id: {}, name: {} },
  },
}))

import { resolveSystemTableFields } from './system-table-resolver'

/**
 * Build the minimal query-chain double used by the system-table resolver.
 * A projection containing `name` is the last-resort `User` lookup in
 * `hydrateActorDisplayNames`; anything else is the system-table read.
 */
function createDatabase(rows: unknown[], userRows: unknown[] = []) {
  return {
    select: (projection: Record<string, unknown>) => ({
      from: () => ({
        where: async () => ('name' in projection ? userRows : rows),
      }),
    }),
  }
}

/** Build a field-value context with the supplied system-table rows. */
function createContext(rows: unknown[], userRows: unknown[] = []): FieldValueContext {
  return {
    db: createDatabase(rows, userRows) as unknown as FieldValueContext['db'],
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
    // The remaining hydration fallbacks (agents, then the org system user) resolve
    // nothing by default — each test only cares about the member lane.
    getCachedAgentsByUserIds.mockReset().mockResolvedValue([])
    getOrgCache.mockReset().mockReturnValue({ get: vi.fn().mockResolvedValue(null) })
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
