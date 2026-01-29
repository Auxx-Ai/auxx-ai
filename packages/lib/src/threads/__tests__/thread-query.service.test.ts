// packages/lib/src/threads/__tests__/thread-query.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThreadQueryService } from '../thread-query.service'
import { InternalFilterContextType } from '../../mail-query/types'
import { createMockRedis } from '../../test/utils'
import { getRedisClient } from '@auxx/redis'

// Mock dependencies
vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn()
}))

// No longer need to mock config since feature flag is removed

vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    Thread: {
      id: 'id',
      lastMessageAt: 'lastMessageAt',
      organizationId: 'organizationId'
    },
    Message: {
      threadId: 'threadId',
      id: 'id',
      subject: 'subject',
      sentAt: 'sentAt',
      snippet: 'snippet',
      isInbound: 'isInbound',
      fromId: 'fromId',
      draftMode: 'draftMode',
      createdById: 'createdById',
      isFirstInThread: 'isFirstInThread'
    },
    ThreadReadStatus: {
      threadId: 'threadId',
      userId: 'userId'
    }
  }
}))

vi.mock('../../mail-views/mail-view-service', () => ({
  MailViewService: vi.fn().mockImplementation(() => ({
    getMailView: vi.fn().mockResolvedValue(null)
  }))
}))

vi.mock('../../mail-query/mail-query-builder', () => ({
  MailQueryBuilder: vi.fn().mockImplementation(() => ({
    buildWhereCondition: vi.fn().mockReturnValue({})
  }))
}))

vi.mock('@auxx/database/enums', () => ({
  DraftMode: {
    NONE: 'NONE',
    PRIVATE: 'PRIVATE',
    SHARED: 'SHARED'
  }
}))

// Mock database instance
const mockDb = {
  execute: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  query: {
    Thread: {
      findMany: vi.fn().mockResolvedValue([])
    },
    Message: {
      findMany: vi.fn().mockResolvedValue([])
    },
    ThreadReadStatus: {
      findMany: vi.fn().mockResolvedValue([])
    }
  },
  transaction: vi.fn().mockImplementation((callback) =>
    callback({
      execute: vi.fn(),
      query: {
        Thread: {
          findMany: vi.fn().mockResolvedValue([])
        },
        ThreadReadStatus: {
          findMany: vi.fn().mockResolvedValue([])
        }
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([])
    })
  )
}

describe('ThreadQueryService', () => {
  let service: ThreadQueryService
  const organizationId = 'test-org-id'

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup Redis mock
    const mockRedis = createMockRedis()
    mockRedis.keys.mockResolvedValue([])
    mockRedis.del.mockResolvedValue(0)
    mockRedis.setex.mockResolvedValue('OK')
    vi.mocked(getRedisClient).mockResolvedValue(mockRedis)

    mockDb.execute.mockResolvedValue({ rows: [] })
    service = new ThreadQueryService(organizationId, mockDb as any)
  })

  describe('Phase 1: Thread ID Query', () => {
    it('should fetch thread IDs in order', async () => {
      const mockThreadRows = [
        { id: 'thread-1', lastMessageAt: new Date() },
        { id: 'thread-2', lastMessageAt: new Date() }
      ]

      mockDb.select.mockReturnThis()
      mockDb.from.mockReturnThis()
      mockDb.where.mockReturnThis()
      mockDb.orderBy.mockReturnThis()
      mockDb.limit.mockResolvedValue(mockThreadRows)

      const input = {
        userId: 'user-123',
        context: { type: InternalFilterContextType.ALL_INBOXES },
        statusFilter: undefined,
        searchQuery: undefined
      }
      const pagination = { limit: 50, cursor: null }

      const result = await (service as any).getThreadIds(undefined, pagination, {
        orderBy: [],
        sort: { field: 'lastMessageAt', direction: 'desc' },
      })

      expect(result.orderedThreadIds).toEqual(['thread-1', 'thread-2'])
      expect(result.nextCursor).toBe(null)
    })

    it('should handle pagination correctly', async () => {
      const mockThreadRows = [
        {
          id: 'thread-1',
          lastMessageAt: '2024-01-02T00:00:00.000Z',
          sortValue: '2024-01-02T00:00:00.000Z',
        },
        {
          id: 'thread-2',
          lastMessageAt: '2024-01-01T00:00:00.000Z',
          sortValue: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'thread-3',
          lastMessageAt: '2023-12-31T00:00:00.000Z',
          sortValue: '2023-12-31T00:00:00.000Z',
        }, // Extra item for pagination
      ]

      mockDb.limit.mockResolvedValue(mockThreadRows)

      const input = {
        userId: 'user-123',
        context: { type: InternalFilterContextType.ALL_INBOXES },
        statusFilter: undefined,
        searchQuery: undefined
      }
      const pagination = { limit: 2, cursor: null }

      const result = await (service as any).getThreadIds(undefined, pagination, {
        orderBy: [],
        sort: { field: 'lastMessageAt', direction: 'desc' },
      })

      expect(result.orderedThreadIds).toEqual(['thread-1', 'thread-2'])
      expect(result.nextCursor).not.toBeNull()

      const decoded = (service as any).decodeCursor(result.nextCursor)
      expect(decoded?.id).toBe('thread-3')
      expect(decoded?.field).toBe('lastMessageAt')
    })
  })

  describe('Sort descriptor handling', () => {
    it('normalizes subject sort into Drizzle expressions', () => {
      const expressions = (service as any).createOrderByFromDescriptor({
        field: 'subject',
        direction: 'asc',
      })

      expect(Array.isArray(expressions)).toBe(true)
      expect(expressions.length).toBeGreaterThan(0)
    })

    it('normalizes sender sort into Drizzle expressions', () => {
      const expressions = (service as any).createOrderByFromDescriptor({
        field: 'sender',
        direction: 'desc',
      })

      expect(Array.isArray(expressions)).toBe(true)
      expect(expressions.length).toBeGreaterThan(0)
    })

    it('passes sort descriptor into getThreadIds when listing threads', async () => {
      const getThreadIdsSpy = vi
        .spyOn(service as any, 'getThreadIds')
        .mockResolvedValue({ orderedThreadIds: [], nextCursor: null })

      await service.listThreads(
        {
          userId: 'user-123',
          context: { type: InternalFilterContextType.ALL },
          statusFilter: undefined,
          searchQuery: undefined,
          sort: { field: 'subject', direction: 'asc' },
        },
        { limit: 10, cursor: null }
      )

      expect(getThreadIdsSpy).toHaveBeenCalledTimes(1)
      const optionsArg = getThreadIdsSpy.mock.calls[0]?.[2]
      expect(optionsArg).toBeDefined()
      expect(Array.isArray(optionsArg.orderBy)).toBe(true)
      expect(optionsArg.sort).toEqual({ field: 'subject', direction: 'asc' })

      getThreadIdsSpy.mockRestore()
    })

    it('encodes and decodes cursor payloads', () => {
      const cursor = (service as any).encodeCursor(
        { field: 'subject', direction: 'desc' },
        { id: 'thread-42', sortValue: 'alpha' }
      )

      const decoded = (service as any).decodeCursor(cursor)
      expect(decoded?.id).toBe('thread-42')
      expect(decoded?.field).toBe('subject')
      expect(decoded?.direction).toBe('desc')
      expect(decoded?.value).toBe('alpha')
    })

    it('parses cursor timestamp strings into Date instances', () => {
      const parsed = (service as any).parseCursorTimestamp('2024-01-01T00:00:00.000Z')
      expect(parsed).toBeInstanceOf(Date)
      expect(parsed?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    })

    it('returns null for invalid cursor timestamp strings', () => {
      const parsed = (service as any).parseCursorTimestamp('not-a-date')
      expect(parsed).toBeNull()
    })
  })

  describe('Phase 2: Fetch Relations', () => {
    it('should fetch latest messages using pointer subquery', async () => {
      const threadIds = ['thread-1', 'thread-2']
      const input = {
        userId: 'user-123',
        context: { type: InternalFilterContextType.ALL_INBOXES },
        statusFilter: undefined,
        searchQuery: undefined
      }

      const commentsSpy = vi
        .spyOn(service as any, 'fetchLatestCommentsForThreads')
        .mockResolvedValue([])

      const mockThreads = [
        { id: 'thread-1', subject: 'Test 1', assignee: null, inbox: null },
        { id: 'thread-2', subject: 'Test 2', assignee: null, inbox: null }
      ]

      mockDb.query.Thread.findMany.mockResolvedValueOnce(mockThreads)

      mockDb.execute.mockResolvedValueOnce({
        rows: [
          { threadId: 'thread-1', messageId: 'msg-1' },
          { threadId: 'thread-2', messageId: 'msg-2' }
        ]
      })

      mockDb.query.Message.findMany.mockResolvedValueOnce([
        {
          id: 'msg-1',
          threadId: 'thread-1',
          draftMode: 'NONE',
          createdTime: new Date(),
          isInbound: true,
          organizationId: 'org',
        },
        {
          id: 'msg-2',
          threadId: 'thread-2',
          draftMode: 'NONE',
          createdTime: new Date(),
          isInbound: true,
          organizationId: 'org',
        }
      ])

      mockDb.query.ThreadReadStatus.findMany.mockResolvedValueOnce([])

      const result = await (service as any).fetchThreadRelations(threadIds, input)

      expect(mockDb.execute).toHaveBeenCalledTimes(1)
      expect(mockDb.query.Message.findMany).toHaveBeenCalledTimes(1)
      expect(result.threadsUnordered).toEqual(mockThreads)
      expect(result.latestMessages.map((msg: any) => msg.id)).toEqual(['msg-1', 'msg-2'])
      expect(result.latestComments).toEqual([])

      commentsSpy.mockRestore()
    })

    it('should handle empty thread IDs', async () => {
      const threadIds: string[] = []
      const input = {
        userId: 'user-123',
        context: { type: InternalFilterContextType.ALL_INBOXES },
        statusFilter: undefined,
        searchQuery: undefined
      }

      const result = await (service as any).fetchThreadRelations(threadIds, input)

      expect(result.threadsUnordered).toEqual([])
      expect(result.latestMessages).toEqual([])
      expect(result.latestComments).toEqual([])
      expect(result.tags).toEqual([])
      expect(result.readStatus).toEqual([])
    })
  })

  describe('Phase 3: Data Assembly', () => {
    it('should preserve thread order', () => {
      const orderedThreadIds = ['thread-2', 'thread-1', 'thread-3']
      const threadsUnordered = [
        { id: 'thread-1', subject: 'Test 1', lastMessageAt: new Date() },
        { id: 'thread-2', subject: 'Test 2', lastMessageAt: new Date() },
        { id: 'thread-3', subject: 'Test 3', lastMessageAt: new Date() }
      ]
      const latestMessages = [
        {
          threadId: 'thread-1',
          id: 'msg-1',
          subject: 'Test 1',
          createdTime: new Date(),
          isInbound: true,
          organizationId: 'org',
        },
      ]
      const latestComments: any[] = []
      const tags: any[] = []
      const readStatus: any[] = []

      const result = (service as any).assembleThreadListItems(
        orderedThreadIds,
        threadsUnordered,
        latestMessages,
        latestComments,
        tags,
        readStatus,
        'user-123'
      )

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('thread-2')
      expect(result[1].id).toBe('thread-1')
      expect(result[2].id).toBe('thread-3')
    })

    it('should handle missing threads gracefully', () => {
      const orderedThreadIds = ['thread-1', 'thread-missing', 'thread-2']
      const threadsUnordered = [
        { id: 'thread-1', subject: 'Test 1', lastMessageAt: new Date() },
        { id: 'thread-2', subject: 'Test 2', lastMessageAt: new Date() }
      ]
      const latestMessages: any[] = []
      const latestComments: any[] = []
      const tags: any[] = []
      const readStatus: any[] = []

      const result = (service as any).assembleThreadListItems(
        orderedThreadIds,
        threadsUnordered,
        latestMessages,
        latestComments,
        tags,
        readStatus,
        'user-123'
      )

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('thread-1')
      expect(result[1].id).toBe('thread-2')
    })
  })

})
