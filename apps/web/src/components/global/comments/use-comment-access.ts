// apps/web/src/components/global/comments/use-comment-access.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { parseRecordId, type RecordId, resolveStaticPrefix } from '@auxx/lib/resources/client'
import { useResource } from '~/components/resources'
import { useThread } from '~/components/threads/hooks'
import { useAccess } from '~/providers/capabilities-provider'

export type CommentParentKind = 'record' | 'thread' | 'unsupported'
export type CommentThreadLens = 'none' | 'metadata' | 'identity' | 'read'

export interface ResolveCommentAccessInput {
  parentKind: CommentParentKind
  commentsView: boolean
  commentsManage: boolean
  canViewParent: boolean
  canAdministerParent: boolean
  threadLens?: CommentThreadLens
  canAdministerInbox?: boolean
}

export interface CommentAccess {
  parentKind: CommentParentKind
  canViewComments: boolean
  canCompose: boolean
  canReact: boolean
  canPin: boolean
  canModerateOthers: boolean
}

/**
 * Resolve comment affordances from the area, parent, and moderation gates.
 */
export function resolveCommentAccess({
  parentKind,
  commentsView,
  commentsManage,
  canViewParent,
  canAdministerParent,
  threadLens = 'none',
  canAdministerInbox = false,
}: ResolveCommentAccessInput): CommentAccess {
  if (parentKind === 'unsupported') {
    return {
      parentKind,
      canViewComments: false,
      canCompose: false,
      canReact: false,
      canPin: false,
      canModerateOthers: false,
    }
  }

  const canViewComments = commentsView && canViewParent
  const canCompose = commentsView && commentsManage && canViewParent

  if (parentKind === 'thread') {
    const hasFullLens = threadLens === 'read'
    return {
      parentKind,
      canViewComments,
      canCompose,
      canReact: canViewComments,
      canPin: canCompose && hasFullLens,
      canModerateOthers: canCompose && hasFullLens && canAdministerInbox,
    }
  }

  return {
    parentKind,
    canViewComments,
    canCompose,
    canReact: canViewComments,
    canPin: canCompose,
    canModerateOthers: canCompose && canAdministerParent,
  }
}

/**
 * Client-side comment capability hint for a record or thread parent.
 *
 * Inbox records are deliberately unsupported comment parents. Thread access
 * follows the mail lens rather than the records definition gate.
 */
export function useCommentAccess(recordId: RecordId | null | undefined): CommentAccess {
  const safeRecordId = recordId ?? ('__missing__:__missing__' as RecordId)
  const { entityDefinitionId, entityInstanceId } = parseRecordId(safeRecordId)
  const { resource } = useResource(entityDefinitionId)
  const { can, canViewEntity, canAdministerDef, canAdminInstance } = useAccess()

  const canonicalDefinition =
    resolveStaticPrefix(entityDefinitionId) ?? resource?.entityType ?? entityDefinitionId
  const parentKind: CommentParentKind =
    canonicalDefinition === 'thread'
      ? 'thread'
      : canonicalDefinition === 'inbox' || canonicalDefinition === 'personal_inbox'
        ? 'unsupported'
        : 'record'

  const commentsView = can(PermissionKey.commentsView)
  const commentsManage = can(PermissionKey.commentsManage)
  const canViewInboxArea = can(PermissionKey.inboxesView)
  const shouldLoadThread =
    parentKind === 'thread' && canViewInboxArea && (commentsView || commentsManage)
  const { thread } = useThread({
    threadId: parentKind === 'thread' ? entityInstanceId : null,
    enabled: shouldLoadThread,
  })

  const threadLens: CommentThreadLens = thread ? (thread.myLens ?? 'read') : 'none'
  const canViewParent =
    parentKind === 'thread'
      ? canViewInboxArea && threadLens !== 'none'
      : parentKind === 'record' && !!resource && canViewEntity(resource.entityDefinitionId)

  return resolveCommentAccess({
    parentKind,
    commentsView,
    commentsManage,
    canViewParent,
    canAdministerParent:
      parentKind === 'record' && !!resource && canAdministerDef(resource.entityDefinitionId),
    threadLens,
    canAdministerInbox:
      parentKind === 'thread' && !!thread?.inboxId && canAdminInstance(thread.inboxId),
  })
}
