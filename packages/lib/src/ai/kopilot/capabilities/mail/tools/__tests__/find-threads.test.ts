// packages/lib/src/ai/kopilot/capabilities/mail/tools/__tests__/find-threads.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../../../agent-framework/types'
import type { GetToolDeps } from '../../../types'
import { buildThreadConditions, createFindThreadsTool } from '../find-threads'

const listThreadIds = vi.fn()
const getThreadMetaBatch = vi.fn()

/** Inboxes the org cache reports. `inbox_hidden` is outside the viewer's lens. */
const inboxes = [
  { id: 'inbox_1', recordId: 'inbox:inbox_1', name: 'Support' },
  { id: 'inbox_hidden', recordId: 'inbox:inbox_hidden', name: 'Founders' },
]

const members = [
  { userId: 'user-1', user: { id: 'user-1', name: 'Ada', email: 'ada@acme.com' } },
  { userId: 'user-2', user: { id: 'user-2', name: 'Grace', email: 'grace@acme.com' } },
]

// Partial mocks — a full replacement of these shared modules breaks collection
// for every other suite that pulls the same graph.
vi.mock('../../../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../cache')>()),
  getCachedUserInstanceGrants: vi.fn(async () => ({
    userId: 'user-1',
    role: 'USER',
    isAdmin: true,
    isMailAdmin: true,
    // Only `inbox_1` is visible to this viewer — `inbox_hidden` must never be
    // named back to the model.
    inboxLens: { inbox_1: 'read' },
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
  })),
  getCachedMembers: vi.fn(async () => members),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => inboxes) })),
}))

vi.mock('../../../../../../threads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../threads')>()),
  ThreadQueryService: class {
    listThreadIds = listThreadIds
    getThreadMetaBatch = getThreadMetaBatch
  },
}))

const getParticipantMetaBatch = vi.fn()

vi.mock('../../../../../../participants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../participants')>()),
  ParticipantService: class {
    getParticipantMetaBatch = getParticipantMetaBatch
  },
}))

/** A thread row as `getThreadMetaBatch` returns it. */
const threadMeta = (over: Record<string, unknown> = {}) => ({
  id: 'thread_1',
  subject: 'Where is my order?',
  status: 'OPEN',
  assigneeId: null,
  lastMessageAt: '2026-07-30T10:00:00.000Z',
  messageCount: 2,
  isUnread: true,
  tagIds: [],
  participants: ['from:participant_1', 'to:participant_2'],
  ...over,
})

const getDeps = (() => ({ db: {} })) as unknown as GetToolDeps
const tool = createFindThreadsTool(getDeps)
const ctx = { organizationId: 'organization-1', userId: 'user-1' } as unknown as ToolContext
const agentDeps = { organizationId: 'organization-1', userId: 'user-1' } as never

const validate = (args: Record<string, unknown>) => tool.validateInputs!(args, ctx)

/** `execute`, narrowed off the streaming-tool arm `find_threads` never takes. */
const run = async (args: Record<string, unknown>) => {
  const result = await tool.execute(args, agentDeps)
  if (Symbol.asyncIterator in result) throw new Error('find_threads is not a streaming tool')
  return result
}

beforeEach(() => {
  listThreadIds.mockReset().mockResolvedValue({ ids: [], total: 0, nextCursor: null })
  getThreadMetaBatch.mockReset().mockResolvedValue([])
  getParticipantMetaBatch.mockReset().mockResolvedValue([])
})

describe('find_threads validateInputs — level 1 (unmapped args)', () => {
  it('rejects an argument the tool does not map, naming the supported ones', async () => {
    const result = await validate({ hasAttachments: true, limit: 25 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('hasAttachments')
    expect(result.error).toContain(
      'status, assigneeId, query, sender, tagIds, inboxId, after, before, sharedWithMe'
    )
    expect(result.error).toContain('limit, sortBy, sortDirection')
  })

  it('lists every unsupported argument, not just the first', async () => {
    const result = await validate({ isUnread: true, ticketId: 'ticket_1', status: 'OPEN' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('isUnread')
    expect(result.error).toContain('ticketId')
  })

  it('accepts the mapped arguments', async () => {
    const result = await validate({
      status: 'OPEN',
      assigneeId: 'user:abc',
      query: 'refund',
      sender: '@acme.com',
      tagIds: ['tag_1'],
      limit: 5,
      sortBy: 'subject',
      sortDirection: 'asc',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual({
      status: 'OPEN',
      assigneeId: 'user:abc',
      query: 'refund',
      sender: '@acme.com',
      tagIds: ['tag_1'],
      limit: 5,
      sortBy: 'subject',
      sortDirection: 'asc',
    })
  })

  it('tolerates the engine-injected context refs and strips them', async () => {
    // `applyContextDefaults` injects these into EVERY tool call before
    // validateInputs runs — they are not model-authored args.
    const result = await validate({ status: 'OPEN', threadId: 'thread_1', actorId: 'user:abc' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual({ status: 'OPEN' })
  })

  it('clamps limit to MAX_RESULTS and rejects a non-numeric one', async () => {
    const clamped = await validate({ status: 'OPEN', limit: 500 })
    expect(clamped.ok && clamped.args.limit).toBe(25)

    const bad = await validate({ status: 'OPEN', limit: 'lots' })
    expect(bad.ok).toBe(false)
  })

  it('rejects an out-of-enum sortBy', async () => {
    const result = await validate({ status: 'OPEN', sortBy: 'relevance' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('lastMessageAt, subject')
  })
})

describe('find_threads validateInputs — level 2 (no invented default)', () => {
  it('rejects a call with no arguments at all', async () => {
    // The §0.2b failing turn: the model sent no filter for "shared with me"
    // and got 25 open threads back.
    const result = await validate({})

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('at least one filter')
  })

  it('rejects a call carrying only result controls', async () => {
    const result = await validate({ limit: 25, sortBy: 'lastMessageAt', sortDirection: 'desc' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('at least one filter')
  })

  it('rejects a call whose only filter is an empty tag list', async () => {
    const result = await validate({ tagIds: [] })

    expect(result.ok).toBe(false)
  })

  it('execute refuses a filterless call rather than inventing status = open', async () => {
    const result = await run({})

    expect(result.success).toBe(false)
    expect(result.error).toContain('at least one filter')
    expect(listThreadIds).not.toHaveBeenCalled()
  })
})

describe('find_threads execute — level 3 (dropped conditions)', () => {
  it('errors instead of querying when the only filter fails to build', async () => {
    // `execute` is reachable without `validateInputs` (evals, replays), so an
    // unknown status still has to be caught here. Before this change the
    // condition was dropped and the query fell back to baseScope.
    const result = await run({ status: 'pending' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('status')
    expect(result.error).toContain('unsupported-operator-or-value')
    expect(listThreadIds).not.toHaveBeenCalled()
  })

  it('runs the query when every filter builds', async () => {
    const result = await run({ status: 'OPEN' })

    expect(result.success).toBe(true)
    expect(listThreadIds).toHaveBeenCalledOnce()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// New parameters (retrieval plan step 2.1 / D1a)
// ═══════════════════════════════════════════════════════════════════════════

/** The conditions the tool handed to the query service, flattened. */
const lastConditions = () => {
  const groups = listThreadIds.mock.calls.at(-1)?.[0]?.filter ?? []
  return groups.flatMap((g: { conditions: unknown[] }) => g.conditions) as Array<{
    id: string
    fieldId: string
    operator: string
    value: unknown
    metadata?: { field?: string }
  }>
}

describe('find_threads — date parameters', () => {
  it('accepts YYYY-MM-DD and anchors it at midnight in the prompt timezone (UTC)', async () => {
    const result = await validate({ after: '2026-07-01' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args.after).toBe('2026-07-01T00:00:00.000Z')
  })

  it('maps after/before onto the date field over lastMessageAt', () => {
    // Asserted on the mapping rather than through `execute`: drizzle columns are
    // undefined under vitest, so `buildDateQuery` declines the (real) column
    // lookup and the condition never reaches the query.
    const conditions = buildThreadConditions({
      after: '2026-07-01T00:00:00.000Z',
      before: '2026-07-31T00:00:00.000Z',
    }).flatMap((g) => g.conditions)
    const byId = new Map(conditions.map((c) => [c.id, c]))

    expect(byId.get('arg:after')).toMatchObject({
      fieldId: 'date',
      operator: 'after',
      value: '2026-07-01T00:00:00.000Z',
      metadata: { field: 'lastMessageAt' },
    })
    expect(byId.get('arg:before')).toMatchObject({
      fieldId: 'date',
      operator: 'before',
      value: '2026-07-31T00:00:00.000Z',
      metadata: { field: 'lastMessageAt' },
    })
  })

  it('rejects a date that is not a real calendar date', async () => {
    const result = await validate({ after: '2026-02-31' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not a real date')
  })

  it('rejects a range that can never match', async () => {
    const result = await validate({ after: '2026-07-31', before: '2026-07-01' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no thread can match')
  })
})

describe('find_threads — sharedWithMe', () => {
  it('maps true onto the sharedWithMe condition', async () => {
    await run({ sharedWithMe: true })

    expect(lastConditions()).toContainEqual(
      expect.objectContaining({ fieldId: 'sharedWithMe', operator: 'is', value: true })
    )
  })

  it('refuses false rather than filtering to "not shared with me"', async () => {
    const result = await validate({ sharedWithMe: false })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('only takes true')
  })
})

describe('find_threads — inboxId', () => {
  it('accepts a raw id and an inbox:<id> record id', async () => {
    await run({ inboxId: 'inbox_1' })
    expect(lastConditions()).toContainEqual(
      expect.objectContaining({ fieldId: 'inbox', operator: 'is', value: 'inbox_1' })
    )

    await run({ inboxId: 'inbox:inbox_1' })
    expect(lastConditions()).toContainEqual(
      expect.objectContaining({ fieldId: 'inbox', value: 'inbox_1' })
    )
  })

  it('errors with the valid values when the id resolves to nothing', async () => {
    const result = await run({ inboxId: 'inbox_nope' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Support (inbox_1)')
    expect(listThreadIds).not.toHaveBeenCalled()
  })

  it('does not name an inbox the viewer cannot see', async () => {
    const result = await run({ inboxId: 'inbox_hidden' })

    expect(result.success).toBe(false)
    expect(result.error).not.toContain('Founders')
    expect(result.error).not.toContain('inbox_hidden)')
  })
})

describe('find_threads — assigneeId resolution', () => {
  it('strips the user: prefix and queries the raw id', async () => {
    await run({ assigneeId: 'user:user-2' })

    expect(lastConditions()).toContainEqual(
      expect.objectContaining({ fieldId: 'assignee', value: 'user-2' })
    )
  })

  it('errors listing valid assignees when the id is not a member', async () => {
    const result = await run({ assigneeId: 'user:nobody' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Ada (user:user-1)')
    expect(listThreadIds).not.toHaveBeenCalled()
  })

  it('rejects a non-user actor id instead of returning an empty list', async () => {
    const result = await run({ assigneeId: 'agent:agent_1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('user actor id')
  })
})

describe('find_threads — status default', () => {
  it('excludes trash/spam/ignored when no status was named, like the mail UI', async () => {
    await run({ assigneeId: 'user:user-1' })

    expect(lastConditions()).toContainEqual(
      expect.objectContaining({
        fieldId: 'status',
        operator: 'not in',
        value: ['TRASH', 'SPAM', 'IGNORED'],
      })
    )
  })

  it('does not add the exclusion when a status was named', async () => {
    await run({ status: 'TRASH' })

    expect(lastConditions().filter((c) => c.fieldId === 'status')).toHaveLength(1)
  })
})

describe('find_threads — sender', () => {
  beforeEach(() => {
    listThreadIds.mockResolvedValue({ ids: ['thread:thread_1'], total: 1, nextCursor: null })
    getThreadMetaBatch.mockResolvedValue([threadMeta()])
  })

  it('returns the sender of the latest message, resolved in one batch', async () => {
    getParticipantMetaBatch.mockResolvedValue([
      {
        id: 'participant_1',
        name: 'Jane Doe',
        displayName: 'Jane Doe',
        identifier: 'jane@example.com',
      },
    ])

    const result = await run({ status: 'OPEN' })

    // Only the `from:` participant is looked up — not `to:`.
    expect(getParticipantMetaBatch).toHaveBeenCalledExactlyOnceWith(['participant_1'])
    const output = result.output as { threads: Array<{ sender: unknown }> }
    expect(output.threads[0]?.sender).toEqual({
      name: 'Jane Doe',
      identifier: 'jane@example.com',
    })
  })

  it('falls back to the identifier when the participant has no name', async () => {
    getParticipantMetaBatch.mockResolvedValue([
      { id: 'participant_1', name: null, displayName: '', identifier: '+4915112345678' },
    ])

    const result = await run({ status: 'OPEN' })

    const output = result.output as {
      threads: Array<{ sender: { name: null; identifier: string } }>
    }
    expect(output.threads[0]?.sender).toEqual({ name: null, identifier: '+4915112345678' })
  })

  it('reports a null sender rather than failing when there is no from participant', async () => {
    getThreadMetaBatch.mockResolvedValue([threadMeta({ participants: ['to:participant_2'] })])

    const result = await run({ status: 'OPEN' })

    expect(getParticipantMetaBatch).not.toHaveBeenCalled()
    const output = result.output as { threads: Array<{ sender: unknown }> }
    expect(output.threads[0]?.sender).toBeNull()
  })

  it('feeds the digest, which used to read a key the output never had', async () => {
    getParticipantMetaBatch.mockResolvedValue([
      {
        id: 'participant_1',
        name: 'Jane Doe',
        displayName: 'Jane Doe',
        identifier: 'jane@example.com',
      },
    ])

    const result = await run({ status: 'OPEN' })
    const digest = tool.buildDigest!(result.output) as {
      sample: Array<{ sender?: string }>
    }

    expect(digest.sample[0]?.sender).toBe('Jane Doe')
  })
})

describe('find_threads — zero results', () => {
  it('carries a suggestion so an empty list is not read as "there are none"', async () => {
    const result = await run({ query: 'refund policy' })

    expect(result.success).toBe(true)
    const output = result.output as { count: number; suggestion?: string }
    expect(output.count).toBe(0)
    expect(output.suggestion).toContain('No threads matched')
    expect(output.suggestion).toContain('EVERY word')
  })
})
