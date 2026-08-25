// packages/lib/src/threads/__tests__/thread-comment-cascade.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getCachedResources,
  inArrayBatches,
  markMailCountsStaleForOrgMembers,
  publishThreadDeleted,
} = vi.hoisted(() => ({
  getCachedResources: vi.fn(),
  inArrayBatches: [] as string[][],
  markMailCountsStaleForOrgMembers: vi.fn(),
  publishThreadDeleted: vi.fn(),
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    inArray: (_column: unknown, values: unknown[] | readonly unknown[]) => {
      inArrayBatches.push([...values] as string[])
      return actual.sql`true`
    },
  }
})
vi.mock('../../cache', () => ({
  getCachedResources,
  getOrgCache: vi.fn(),
}))
vi.mock('../../events/publisher', () => ({
  publisher: { publishLater: vi.fn() },
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: vi.fn(() => ({ marker: 'realtime' })),
  publishThreadDeleted,
  publishThreadUpdated: vi.fn(),
}))
vi.mock('../mail-counts', () => ({ markMailCountsStaleForOrgMembers }))

const { ThreadMutationService } = await import('../thread-mutation.service')

const organizationId = 'org_1'

function databaseWithDeletedThreads(
  deletedThreads: Array<{ id: string; inboxId: string | null; assigneeId: string | null }>
): {
  db: Database
  operations: string[]
  transaction: ReturnType<typeof vi.fn>
} {
  const operations: string[] = []
  let deleteCount = 0
  const tx = {
    delete: vi.fn(() => {
      deleteCount += 1
      if (deleteCount === 1) {
        operations.push('thread')
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(deletedThreads),
          })),
        }
      }
      if (deleteCount === 2) {
        operations.push('comment')
        return { where: vi.fn().mockResolvedValue(undefined) }
      }
      // Deletes 3 and 4 are the relation sweep — `FieldValue` rows pointing AT
      // the deleted threads, then the threads' own values. Both `RETURNING`.
      if (deleteCount === 3 || deleteCount === 4) {
        operations.push(deleteCount === 3 ? 'fieldvalue-inbound' : 'fieldvalue-outbound')
        return {
          where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
        }
      }
      throw new Error('Unexpected delete table')
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  }
  const transaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
    callback(tx)
  )
  return {
    db: { transaction } as unknown as Database,
    operations,
    transaction,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  inArrayBatches.length = 0
  getCachedResources.mockResolvedValue([
    {
      id: 'thread',
      apiSlug: 'thread',
      entityDefinitionId: 'def_thread',
      entityType: 'thread',
    },
  ])
  publishThreadDeleted.mockResolvedValue(undefined)
  markMailCountsStaleForOrgMembers.mockResolvedValue(undefined)
})

describe('thread permanent-delete comment cascade', () => {
  it('does not delete comments when the single thread does not exist', async () => {
    const { db, operations, transaction } = databaseWithDeletedThreads([])
    const service = new ThreadMutationService(organizationId, db, undefined, undefined, {
      kind: 'system',
    })

    await expect(service.deletePermanently('thread_missing')).rejects.toThrow(
      'Thread thread_missing not found for deletion'
    )
    expect(transaction).toHaveBeenCalledOnce()
    expect(operations).toEqual(['thread'])
    expect(publishThreadDeleted).not.toHaveBeenCalled()
  })

  it('bulk-deletes comments only for threads actually deleted in the transaction', async () => {
    const deleted = [{ id: 'thread_1', inboxId: 'inbox_1', assigneeId: null }]
    const { db, operations, transaction } = databaseWithDeletedThreads(deleted)
    const service = new ThreadMutationService(organizationId, db, undefined, undefined, {
      kind: 'system',
    })

    await expect(service.bulkDeletePermanently(['thread_1', 'thread_missing'])).resolves.toEqual({
      count: 1,
    })
    expect(transaction).toHaveBeenCalledOnce()
    expect(operations).toEqual(['thread', 'comment', 'fieldvalue-inbound', 'fieldvalue-outbound'])
    expect(inArrayBatches[0]).toEqual(['thread_1', 'thread_missing'])
    expect(inArrayBatches[1]).toEqual(['thread_1'])
    expect(publishThreadDeleted).toHaveBeenCalledOnce()
  })
})
