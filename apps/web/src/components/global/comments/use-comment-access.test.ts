// apps/web/src/components/global/comments/use-comment-access.test.ts

// apps/web/src/components/global/comments/use-comment-access.test.ts

import { describe, expect, it } from 'vitest'
import { resolveCommentAccess } from './use-comment-access'

describe('resolveCommentAccess', () => {
  it('requires comment read and record view for the comments surface', () => {
    expect(
      resolveCommentAccess({
        parentKind: 'record',
        commentsView: false,
        commentsManage: true,
        canViewParent: true,
        canAdministerParent: true,
      })
    ).toMatchObject({
      canViewComments: false,
      canCompose: false,
      canReact: false,
      canPin: false,
      canModerateOthers: false,
    })
  })

  it('lets a visible subject-lens thread read and compose without full-lens moderation', () => {
    expect(
      resolveCommentAccess({
        parentKind: 'thread',
        commentsView: true,
        commentsManage: true,
        canViewParent: true,
        canAdministerParent: false,
        threadLens: 'subject',
        canAdministerInbox: true,
      })
    ).toMatchObject({
      canViewComments: true,
      canCompose: true,
      canReact: true,
      canPin: false,
      canModerateOthers: false,
    })
  })

  it('requires a full thread lens and inbox administration to moderate other authors', () => {
    expect(
      resolveCommentAccess({
        parentKind: 'thread',
        commentsView: true,
        commentsManage: true,
        canViewParent: true,
        canAdministerParent: false,
        threadLens: 'full',
        canAdministerInbox: true,
      })
    ).toMatchObject({
      canPin: true,
      canModerateOthers: true,
    })
  })

  it('never exposes comments for inbox parents', () => {
    expect(
      resolveCommentAccess({
        parentKind: 'unsupported',
        commentsView: true,
        commentsManage: true,
        canViewParent: true,
        canAdministerParent: true,
        threadLens: 'full',
        canAdministerInbox: true,
      })
    ).toEqual({
      parentKind: 'unsupported',
      canViewComments: false,
      canCompose: false,
      canReact: false,
      canPin: false,
      canModerateOthers: false,
    })
  })
})
