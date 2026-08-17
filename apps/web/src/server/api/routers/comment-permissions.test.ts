// apps/web/src/server/api/routers/comment-permissions.test.ts

// apps/web/src/server/api/routers/comment-permissions.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const COMMENT_ID = 'cmt_cuid000000000000000000000'
const RECORD_ID = 'contact:rec_cuid00000000000000000000'

const { service, constructorArgs } = vi.hoisted(() => ({
  service: {
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    getById: vi.fn(),
    getCommentsByRecordId: vi.fn(),
    pinComment: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
  },
  constructorArgs: [] as unknown[][],
}))

vi.mock('@auxx/lib/comments', () => ({
  CommentService: class {
    constructor(...args: unknown[]) {
      constructorArgs.push(args)
    }

    createComment = service.createComment
    updateComment = service.updateComment
    deleteComment = service.deleteComment
    getById = service.getById
    getCommentsByRecordId = service.getCommentsByRecordId
    pinComment = service.pinComment
    addReaction = service.addReaction
    removeReaction = service.removeReaction
  },
}))

vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey }
})

vi.mock('@auxx/lib/tiptap', () => ({ isNonEmptyDoc: () => true }))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    isAuxxError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in (error as Record<string, unknown>),
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (permission: string) => void } }).capabilities.assert(
          key
        )
        return next()
      }),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { commentRouter } = await import('./comment')

type Capabilities = InstanceType<typeof CapabilitySet>

function capabilitiesFor(comments: Level): Capabilities {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.comments]: comments })),
    {},
    'MEMBER',
    'full'
  )
}

const db = { marker: 'comment-router-db' }

function caller(capabilities: Capabilities) {
  return commentRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
    },
  } as never)
}

const comment = {
  id: COMMENT_ID,
  entityDefinitionId: 'contact',
  entityId: 'rec_cuid00000000000000000000',
  createdById: USER_ID,
  replies: [],
}

const contentJson = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

const READ_CALLS = [
  ['getById', (c: ReturnType<typeof caller>) => c.getById({ id: COMMENT_ID })],
  ['getByRecordId', (c: ReturnType<typeof caller>) => c.getByRecordId({ recordId: RECORD_ID })],
  [
    'addReaction',
    (c: ReturnType<typeof caller>) =>
      c.addReaction({ commentId: COMMENT_ID, type: 'like', emoji: null }),
  ],
  [
    'removeReaction',
    (c: ReturnType<typeof caller>) =>
      c.removeReaction({ commentId: COMMENT_ID, type: 'like', emoji: null }),
  ],
] as const

const WRITE_CALLS = [
  [
    'create',
    (c: ReturnType<typeof caller>) =>
      c.create({ contentJson, recordId: RECORD_ID, parentId: null }),
  ],
  ['update', (c: ReturnType<typeof caller>) => c.update({ id: COMMENT_ID, contentJson })],
  ['delete', (c: ReturnType<typeof caller>) => c.delete({ id: COMMENT_ID })],
  ['togglePin', (c: ReturnType<typeof caller>) => c.togglePin({ id: COMMENT_ID, pin: true })],
] as const

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

beforeEach(() => {
  constructorArgs.length = 0
  for (const method of Object.values(service)) method.mockReset()

  service.createComment.mockResolvedValue(comment)
  service.updateComment.mockResolvedValue(comment)
  service.deleteComment.mockResolvedValue(undefined)
  service.getById.mockResolvedValue(comment)
  service.getCommentsByRecordId.mockResolvedValue([comment])
  service.pinComment.mockResolvedValue(comment)
  service.addReaction.mockResolvedValue({ id: 'reaction_1' })
  service.removeReaction.mockResolvedValue(undefined)
})

describe('comment router permissions', () => {
  it.each(
    READ_CALLS
  )('%s denies comments: None before constructing the service', async (_name, call) => {
    await expect(call(caller(capabilitiesFor(Level.None)))).rejects.toMatchObject(FORBIDDEN)
    expect(constructorArgs).toHaveLength(0)
  })

  it.each(READ_CALLS)('%s allows comments: Read', async (_name, call) => {
    const capabilities = capabilitiesFor(Level.Read)
    await expect(call(caller(capabilities))).resolves.toBeDefined()
    expect(constructorArgs.at(-1)).toEqual([ORG_ID, USER_ID, db, capabilities])
  })

  it.each(
    WRITE_CALLS
  )('%s denies comments: Read before constructing the service', async (_name, call) => {
    await expect(call(caller(capabilitiesFor(Level.Read)))).rejects.toMatchObject(FORBIDDEN)
    expect(constructorArgs).toHaveLength(0)
  })

  it.each(WRITE_CALLS)('%s allows comments: Full', async (_name, call) => {
    const capabilities = capabilitiesFor(Level.Full)
    await expect(call(caller(capabilities))).resolves.toBeDefined()
    expect(constructorArgs.at(-1)).toEqual([ORG_ID, USER_ID, db, capabilities])
  })

  it('preserves a service AuxxError instead of flattening it to a 500', async () => {
    const forbidden = Object.assign(new Error('Parent record is not visible'), {
      name: 'ForbiddenError',
      statusCode: 403,
    })
    service.getById.mockRejectedValue(forbidden)

    await expect(
      caller(capabilitiesFor(Level.Read)).getById({ id: COMMENT_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})
