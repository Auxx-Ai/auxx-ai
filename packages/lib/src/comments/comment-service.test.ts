// packages/lib/src/comments/comment-service.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../errors'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { PermissionKey } from '../permissions/capabilities/registry'
import { satisfiesRung } from '../permissions/capabilities/rung'
import { toRecordId } from '../resources/resource-id'

const {
  assertCanActOnThreads,
  getCachedResources,
  getCachedUserInstanceGrants,
  getThreadLens,
  inboxAccessRecordId,
} = vi.hoisted(() => ({
  assertCanActOnThreads: vi.fn(),
  getCachedResources: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
  getThreadLens: vi.fn(),
  inboxAccessRecordId: vi.fn(),
}))

vi.mock('../cache/org-cache-helpers', () => ({ getCachedResources }))
vi.mock('../cache/user-cache-helpers', () => ({
  getCachedUserInstanceGrants,
}))
vi.mock('../events', () => ({
  publisher: { publishLater: vi.fn() },
}))
vi.mock('../files/core/attachment-service', () => ({
  AttachmentService: class {
    fetchAttachmentsForEntities = vi.fn().mockResolvedValue(new Map())
  },
}))
vi.mock('../files/core/media-asset-service', () => ({
  MediaAssetService: class {},
}))
vi.mock('../notifications/notification-service', () => ({
  NotificationService: class {},
}))
vi.mock('../permissions/visibility/thread-lens', () => ({ getThreadLens }))
vi.mock('../resource-access/mail-sharing-guard', () => ({ inboxAccessRecordId }))
vi.mock('../threads/thread-action-access', () => ({ assertCanActOnThreads }))

const { CommentService } = await import('./comment-service')

const organizationId = 'org_1'
const userId = 'user_1'

function structuralCapabilities(overrides: Partial<CapabilityView> = {}): CapabilityView {
  // Read the def gates through the overrides so the record lane below derives
  // from the SAME answers the caller configured — a denied def stays denied all
  // the way down instead of being hardcoded back open.
  const canViewEntity = overrides.canViewEntity ?? (() => true)
  const has = overrides.has ?? (() => true)
  return {
    can: () => true,
    has,
    assert: () => undefined,
    areaLevel: () => 0,
    canWriteEntity: () => true,
    assertWriteEntity: () => undefined,
    canEditEntity: () => true,
    assertEditEntity: () => undefined,
    filterEditableDefIds: (ids) => ids,
    canViewEntity,
    assertViewEntity: () => undefined,
    filterViewableDefIds: (ids) => ids,
    // Record lane (plan v3/03 §5.2–5.3). This stub holds no per-record
    // `ResourceAccess` grants, so the row-effective rung is just the def rung:
    // viewable and editable but not administrable ⇒ `edit`.
    hasDefPresence: (id) => canViewEntity(id),
    hasRecordGrantsOn: () => false,
    recordDefRung: (id) => (canViewEntity(id) ? 'edit' : undefined),
    recordAccessAt: (id) => (canViewEntity(id) ? 'edit' : 'none'),
    // Mirrors `canRecordVerbAtRung(caps, access, recordsDelete)`: an `edit`
    // floor, then the key — which this stub's `has` answers.
    canDeleteRecordAt: (access) =>
      satisfiesRung(access, 'edit') &&
      (has(PermissionKey.recordsDelete) || satisfiesRung(access, 'admin')),
    canEditRecordAt: (access) => satisfiesRung(access, 'edit'),
    viewAccessFor: () => undefined,
    canAdministerDef: () => false,
    assertAdministerDef: () => undefined,
    canViewInstance: () => false,
    canEditInstance: () => false,
    canAdminInstance: () => false,
    assertViewInstance: () => undefined,
    assertEditInstance: () => undefined,
    assertAdminInstance: () => undefined,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getCachedUserInstanceGrants.mockResolvedValue({
    userId,
    isAdmin: false,
  })
  getThreadLens.mockResolvedValue('full')
  assertCanActOnThreads.mockResolvedValue(undefined)
  inboxAccessRecordId.mockResolvedValue('inbox:inbox_1')
  getCachedResources.mockResolvedValue([
    {
      id: 'contact',
      apiSlug: 'contact',
      entityDefinitionId: 'def_contact',
      entityType: 'contact',
    },
    {
      id: 'inbox',
      apiSlug: 'inbox',
      entityDefinitionId: 'def_inbox',
      entityType: 'inbox',
    },
    {
      id: 'thread',
      apiSlug: 'thread',
      entityDefinitionId: 'def_thread',
      entityType: 'thread',
    },
    {
      id: 'deal',
      apiSlug: 'deal',
      entityDefinitionId: 'def_deal',
      entityType: 'deal',
    },
  ])
})

describe('CommentService authorization', () => {
  it('accepts a structural CapabilityView and returns 403 for an inaccessible known comment', async () => {
    const entityFindFirst = vi.fn().mockResolvedValue({ organizationId })
    const db = {
      query: {
        Comment: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'comment_1',
            organizationId,
            entityDefinitionId: 'def_contact',
            entityId: 'record_1',
            reactions: [],
          }),
        },
        EntityInstance: {
          findFirst: entityFindFirst,
        },
      },
    } as unknown as Database
    const capabilities = structuralCapabilities({ canViewEntity: () => false })
    const service = new CommentService(organizationId, userId, db, capabilities)

    await expect(service.getById('comment_1')).rejects.toMatchObject({
      name: 'ForbiddenError',
      statusCode: 403,
    })
    expect(entityFindFirst).not.toHaveBeenCalled()
  })

  it('checks the inbox front door before reading a thread row', async () => {
    const threadFindFirst = vi.fn()
    let assertionCount = 0
    const capabilities = structuralCapabilities({
      assert: () => {
        assertionCount += 1
        if (assertionCount === 2) throw new ForbiddenError('Inbox access denied')
      },
    })
    const db = {
      query: {
        Thread: { findFirst: threadFindFirst },
      },
    } as unknown as Database
    const service = new CommentService(organizationId, userId, db, capabilities)

    await expect(
      service.getCommentsByRecordId(toRecordId('def_thread', 'thread_1'))
    ).rejects.toMatchObject({
      name: 'ForbiddenError',
      statusCode: 403,
    })
    expect(threadFindFirst).not.toHaveBeenCalled()
  })

  it('rejects an unsupported inbox host even in explicit unrestricted mode', async () => {
    const service = new CommentService(organizationId, userId, {} as Database, null)

    await expect(
      service.getCommentsByRecordId(toRecordId('inbox', 'inbox_1'))
    ).rejects.toMatchObject({
      name: 'BadRequestError',
      statusCode: 400,
    })
  })

  it('allows the explicit null cascade to purge unreachable historical inbox comments', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn().mockReturnValue({ where })
    const db = {
      query: {
        EntityInstance: {
          findFirst: vi.fn().mockResolvedValue({
            organizationId,
            entityDefinitionId: 'def_inbox',
          }),
        },
      },
      delete: deleteRows,
    } as unknown as Database
    const service = new CommentService(organizationId, userId, db, null)

    await expect(
      service.deleteCommentsByRecordId(toRecordId('def_inbox', 'inbox_1'))
    ).resolves.toBeUndefined()
    expect(deleteRows).toHaveBeenCalledOnce()
    expect(where).toHaveBeenCalledOnce()
  })

  it('rejects an instance paired with a different visible definition prefix', async () => {
    const db = {
      query: {
        EntityInstance: {
          findFirst: vi.fn().mockResolvedValue({
            organizationId,
            entityDefinitionId: 'def_deal',
          }),
        },
      },
    } as unknown as Database
    const service = new CommentService(organizationId, userId, db, structuralCapabilities())

    await expect(
      service.getCommentsByRecordId(toRecordId('def_contact', 'record_1'))
    ).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
    })
  })

  it('rejects a reply parent on another record without confirming that parent', async () => {
    const db = {
      query: {
        EntityInstance: {
          findFirst: vi.fn().mockResolvedValue({
            organizationId,
            entityDefinitionId: 'def_contact',
          }),
        },
        Comment: {
          findFirst: vi.fn().mockResolvedValue({
            createdById: 'user_2',
            entityId: 'record_2',
            entityDefinitionId: 'def_contact',
          }),
        },
      },
    } as unknown as Database
    const service = new CommentService(organizationId, userId, db, structuralCapabilities())

    await expect(
      service.createComment({
        contentJson: { type: 'doc', content: [] },
        recordId: toRecordId('def_contact', 'record_1'),
        createdById: userId,
        parentId: 'comment_2',
      })
    ).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
    })
  })

  it.each([
    ['the author', userId, false, true],
    ['a definition administrator', 'user_2', true, true],
    ['a plain non-author', 'user_2', false, false],
  ] as const)('allows record moderation for %s', async (_label, createdById, canAdministerDef, allowed) => {
    const db = {
      query: {
        Comment: {
          findFirst: vi.fn().mockResolvedValue({
            createdById,
            entityId: 'record_1',
            entityDefinitionId: 'def_contact',
            organizationId,
          }),
        },
        EntityInstance: {
          findFirst: vi.fn().mockResolvedValue({
            organizationId,
            entityDefinitionId: 'def_contact',
          }),
        },
      },
    } as unknown as Database
    const service = new CommentService(
      organizationId,
      userId,
      db,
      structuralCapabilities({ canAdministerDef: () => canAdministerDef })
    )
    const moderate = (
      service as unknown as {
        assertCanModifyComment: (id: string, message: string) => Promise<unknown>
      }
    ).assertCanModifyComment.bind(service)
    const result = moderate('comment_1', 'Moderation denied')

    if (allowed) {
      await expect(result).resolves.toMatchObject({ createdById })
    } else {
      await expect(result).rejects.toMatchObject({
        name: 'ForbiddenError',
        statusCode: 403,
      })
    }
  })

  it('requires full thread access before pinning', async () => {
    assertCanActOnThreads.mockRejectedValueOnce(new ForbiddenError('Full lens required'))
    const update = vi.fn()
    const db = {
      query: {
        Comment: {
          findFirst: vi.fn().mockResolvedValue({
            entityId: 'thread_1',
            entityDefinitionId: 'def_thread',
            organizationId,
          }),
        },
        Thread: {
          findFirst: vi.fn().mockResolvedValue({ organizationId, inboxId: 'inbox_1' }),
        },
      },
      update,
    } as unknown as Database
    const service = new CommentService(organizationId, userId, db, structuralCapabilities())

    await expect(service.pinComment('comment_1', userId, true)).rejects.toMatchObject({
      name: 'ForbiddenError',
      statusCode: 403,
    })
    expect(assertCanActOnThreads).toHaveBeenCalledWith(
      db,
      organizationId,
      expect.objectContaining({ isAdmin: false }),
      ['thread_1']
    )
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ['an inbox manager', true, true],
    ['a non-manager', false, false],
  ] as const)('moderates another author’s full-lens thread note as %s', async (_label, canAdminInstance, allowed) => {
    const db = {
      query: {
        Comment: {
          findFirst: vi.fn().mockResolvedValue({
            createdById: 'user_2',
            entityId: 'thread_1',
            entityDefinitionId: 'def_thread',
            organizationId,
          }),
        },
        Thread: {
          findFirst: vi.fn().mockResolvedValue({ organizationId, inboxId: 'inbox_1' }),
        },
      },
    } as unknown as Database
    const service = new CommentService(
      organizationId,
      userId,
      db,
      structuralCapabilities({ canAdminInstance: () => canAdminInstance })
    )
    const moderate = (
      service as unknown as {
        assertCanModifyComment: (id: string, message: string) => Promise<unknown>
      }
    ).assertCanModifyComment.bind(service)
    const result = moderate('comment_1', 'Moderation denied')

    if (allowed) {
      await expect(result).resolves.toMatchObject({ createdById: 'user_2' })
    } else {
      await expect(result).rejects.toMatchObject({
        name: 'ForbiddenError',
        statusCode: 403,
      })
    }
    expect(assertCanActOnThreads).toHaveBeenCalled()
    expect(inboxAccessRecordId).toHaveBeenCalledWith(organizationId, 'inbox_1')
  })
})
