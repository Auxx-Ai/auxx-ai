// packages/lib/src/resources/crud/__tests__/group-by-handler.test.ts
//
// Handler side of table grouping: `listFiltered` forwards the group inputs and
// refuses them on the system lane; `groupSummary` mirrors listFiltered's preamble.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const paged = vi.hoisted(() => vi.fn())
const summary = vi.hoisted(() => vi.fn())
const DEF_ID = vi.hoisted(() => 'edf000000000000000000001')

vi.mock('../unified-handler-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../unified-handler-queries')>()
  return { ...actual, queryEntityInstanceIdsPaged: paged }
})

vi.mock('../../grouping/group-summary', () => ({ queryEntityGroupSummary: summary }))

vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../cache')>()
  return {
    ...actual,
    findCachedResource: vi.fn(async () => ({ id: DEF_ID, entityDefinitionId: DEF_ID })),
  }
})

vi.mock('../../../resource-access/grantee-resolution', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../resource-access/grantee-resolution')>()
  return {
    ...actual,
    resolveResourceAccessGrantees: vi.fn(async () => ({
      userId: 'user_1',
      groupIds: [],
      profileId: null,
    })),
  }
})

import { ForbiddenError, UnprocessableEntityError } from '../../../errors'
import { UnifiedCrudHandler } from '../unified-handler'

const handler = (capabilities?: unknown) =>
  new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, {
    capabilities: capabilities as never,
  })

const groupBy = { fieldId: `${DEF_ID}:status`, desc: true }

beforeEach(() => {
  paged.mockReset()
  paged.mockResolvedValue({ ids: [], hasMore: false })
  summary.mockReset()
  summary.mockResolvedValue(
    ok({ groups: [{ key: 'a', count: 2, aggregates: {} }], hasMoreGroups: false })
  )
})

describe('UnifiedCrudHandler.listFiltered — grouping', () => {
  it('forwards groupBy, timezone and excludeGroupKeys to the paged query', async () => {
    await handler().listFiltered({
      entityDefinitionId: DEF_ID,
      groupBy,
      timezone: 'Europe/Berlin',
      excludeGroupKeys: ['__empty__'],
    })
    expect(paged).toHaveBeenCalledWith(
      expect.objectContaining({
        groupBy,
        timezone: 'Europe/Berlin',
        excludeGroupKeys: ['__empty__'],
      })
    )
  })

  it('refuses groupBy on a system resource instead of ignoring it', async () => {
    await expect(
      handler().listFiltered({ entityDefinitionId: 'user', groupBy })
    ).rejects.toBeInstanceOf(UnprocessableEntityError)
    expect(paged).not.toHaveBeenCalled()
  })
})

describe('UnifiedCrudHandler.groupSummary', () => {
  it('refuses the mail-lens tables and system resources', async () => {
    await expect(
      handler().groupSummary({ entityDefinitionId: 'thread', groupBy })
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      handler().groupSummary({ entityDefinitionId: 'user', groupBy })
    ).rejects.toBeInstanceOf(UnprocessableEntityError)
    expect(summary).not.toHaveBeenCalled()
  })

  it('arm none returns no groups without querying', async () => {
    const caps = { canViewEntity: vi.fn(() => false), hasRecordGrantsOn: vi.fn(() => false) }
    const r = await handler(caps).groupSummary({ entityDefinitionId: DEF_ID, groupBy })
    expect(r).toEqual({ groups: [], hasMoreGroups: false })
    expect(summary).not.toHaveBeenCalled()
  })

  it('forwards inputs and the visibility predicate, resolving currentUser filters', async () => {
    const caps = { canViewEntity: vi.fn(() => false), hasRecordGrantsOn: vi.fn(() => true) }
    const r = await handler(caps).groupSummary({
      entityDefinitionId: DEF_ID,
      groupBy,
      timezone: 'UTC',
      search: 'acme',
      aggregates: { [`${DEF_ID}:amount`]: 'sum' },
    })
    expect(r.groups).toEqual([{ key: 'a', count: 2, aggregates: {} }])
    const [, params] = summary.mock.calls[0]!
    expect(params).toMatchObject({
      entityDefinitionId: DEF_ID,
      organizationId: 'org_1',
      groupBy,
      timezone: 'UTC',
      search: 'acme',
      aggregates: { [`${DEF_ID}:amount`]: 'sum' },
    })
    expect(params.visibilityWhere).toBeDefined()
  })

  it('throws the lib error on an err result', async () => {
    summary.mockResolvedValue(err(new UnprocessableEntityError('nope')))
    await expect(
      handler().groupSummary({ entityDefinitionId: DEF_ID, groupBy })
    ).rejects.toBeInstanceOf(UnprocessableEntityError)
  })
})
