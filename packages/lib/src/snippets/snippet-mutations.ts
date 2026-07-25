// packages/lib/src/snippets/snippet-mutations.ts

import { type Database, schema } from '@auxx/database'
import {
  BuiltInEntityType,
  ResourceGranteeType,
  ResourcePermission,
  SnippetSharingType,
} from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, sql } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { getInstanceAccess, setInstanceAccess } from '../resource-access'
import { guard } from './guard'
import { resolveCanEdit } from './snippet-permissions'

const snippetWith = {
  folder: true,
  createdBy: { columns: { id: true, name: true, email: true, image: true } },
} as const

async function assertFolderInOrg(db: Database, organizationId: string, folderId: string) {
  const folder = await db.query.SnippetFolder.findFirst({
    where: and(
      eq(schema.SnippetFolder.id, folderId),
      eq(schema.SnippetFolder.organizationId, organizationId)
    ),
  })
  if (!folder) {
    throw new BadRequestError('Selected folder not found')
  }
}

export interface CreateSnippetInput {
  title: string
  content: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType: SnippetSharingType
}

/** Create a snippet (verifying the target folder belongs to the org). */
export async function createSnippet(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateSnippetInput
) {
  return guard(async () => {
    if (input.folderId) {
      await assertFolderInOrg(db, organizationId, input.folderId)
    }

    const [snippet] = await db
      .insert(schema.Snippet)
      .values({
        title: input.title,
        content: input.content,
        contentHtml: input.contentHtml,
        description: input.description,
        folderId: input.folderId,
        sharingType: input.sharingType,
        organizationId,
        createdById: userId,
        updatedAt: new Date(),
      })
      .returning()

    return db.query.Snippet.findFirst({
      where: eq(schema.Snippet.id, snippet.id),
      with: snippetWith,
    })
  }, 'Error creating snippet')
}

export interface UpdateSnippetInput {
  title?: string
  content?: string
  contentHtml?: string
  description?: string
  folderId?: string | null
  sharingType?: SnippetSharingType
  isFavorite?: boolean
}

/** Update a snippet, enforcing edit access and creator-only sharing changes. */
export async function updateSnippet(
  db: Database,
  organizationId: string,
  userId: string,
  snippetId: string,
  input: UpdateSnippetInput
) {
  return guard(
    async () => {
      const existing = await db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, snippetId),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false)
        ),
      })

      if (!existing) {
        throw new NotFoundError('Snippet not found')
      }

      if (existing.systemType != null) {
        throw new ForbiddenError('System snippets cannot be modified')
      }

      let canEdit = existing.createdById === userId
      if (!canEdit) {
        const shares = await getInstanceAccess(
          { db, organizationId },
          toRecordId(BuiltInEntityType.snippet, snippetId)
        )
        canEdit = await resolveCanEdit(organizationId, userId, existing.createdById, shares)
      }

      if (!canEdit) {
        throw new ForbiddenError('You do not have permission to edit this snippet')
      }

      // Only the creator can change sharing settings
      if (input.sharingType && existing.createdById !== userId) {
        throw new ForbiddenError('Only the creator can change sharing settings')
      }

      if (input.folderId) {
        await assertFolderInOrg(db, organizationId, input.folderId)
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (input.title !== undefined) updateData.title = input.title
      if (input.content !== undefined) updateData.content = input.content
      if (input.contentHtml !== undefined) updateData.contentHtml = input.contentHtml
      if (input.description !== undefined) updateData.description = input.description
      if (input.folderId !== undefined) updateData.folderId = input.folderId
      if (input.sharingType !== undefined) updateData.sharingType = input.sharingType
      if (input.isFavorite !== undefined) updateData.isFavorite = input.isFavorite

      await db.update(schema.Snippet).set(updateData).where(eq(schema.Snippet.id, snippetId))

      return db.query.Snippet.findFirst({
        where: eq(schema.Snippet.id, snippetId),
        with: snippetWith,
      })
    },
    'Error updating snippet',
    { snippetId }
  )
}

/** Soft-delete a snippet (creator or org admin/owner only). */
export async function deleteSnippet(
  db: Database,
  organizationId: string,
  userId: string,
  snippetId: string
) {
  return guard(
    async () => {
      const existing = await db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, snippetId),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false)
        ),
      })

      if (!existing) {
        throw new NotFoundError('Snippet not found')
      }

      if (existing.systemType != null) {
        throw new ForbiddenError('System snippets cannot be modified')
      }

      const membership = await db.query.OrganizationMember.findFirst({
        where: and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, organizationId)
        ),
      })

      if (
        existing.createdById !== userId &&
        membership?.role !== 'ADMIN' &&
        membership?.role !== 'OWNER'
      ) {
        throw new ForbiddenError('You do not have permission to delete this snippet')
      }

      await db
        .update(schema.Snippet)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(schema.Snippet.id, snippetId))
    },
    'Error deleting snippet',
    { snippetId }
  )
}

/**
 * The grantee kinds a snippet may be shared with — the SINGLE source of truth
 * for the router's input schema, the share partition below, and the read side.
 *
 * `profile` is included per doc 19 §0.28 (a snippet share is a `ResourceAccess`
 * **instance** grant, so the profile is selectable as an additive grantee).
 * `role` and `team` are deliberately absent: `role:org_member` is the
 * workspace-baseline marker and a snippet expresses "everyone" through
 * `SnippetSharingType.ORGANIZATION` instead, so a role row here would be a
 * second, conflicting way to say the same thing.
 *
 * Because {@link setSnippetSharing} replaces grants **per grantee type**, a kind
 * that is missing from this list is not merely unsupported — its existing rows
 * are never cleared and its incoming rows are never written. Anything added to
 * `ResourceGranteeType` must therefore be listed here or explicitly rejected;
 * `assertSupportedShareGrantees` makes that failure loud.
 */
export const SNIPPET_SHARE_GRANTEE_TYPES = [
  ResourceGranteeType.group,
  ResourceGranteeType.user,
  ResourceGranteeType.profile,
] as const

/** A grantee kind a snippet may be shared with. See {@link SNIPPET_SHARE_GRANTEE_TYPES}. */
export type SnippetShareGranteeType = (typeof SNIPPET_SHARE_GRANTEE_TYPES)[number]

export interface SnippetShareInput {
  granteeType: SnippetShareGranteeType
  granteeId: string
  permission: 'VIEW' | 'EDIT'
}

/**
 * Reject a share whose grantee kind this function cannot store. Without it the
 * per-type replace below drops the row silently — no error, no log, and the UI
 * reports success (19a site 28).
 */
function assertSupportedShareGrantees(shares: SnippetShareInput[]): void {
  const supported: readonly string[] = SNIPPET_SHARE_GRANTEE_TYPES
  const unsupported = shares.find((s) => !supported.includes(s.granteeType))
  if (unsupported) {
    throw new BadRequestError(
      `Snippets cannot be shared with a "${unsupported.granteeType}" grantee. Supported: ${SNIPPET_SHARE_GRANTEE_TYPES.join(', ')}.`
    )
  }
}

/**
 * Replace a snippet's sharing settings (creator only). For GROUPS sharing the
 * provided grants replace the existing rows of every supported grantee kind
 * ({@link SNIPPET_SHARE_GRANTEE_TYPES}); any other sharing type clears all
 * ResourceAccess for the snippet. Wrapped in a transaction.
 */
export async function setSnippetSharing(
  db: Database,
  organizationId: string,
  userId: string,
  snippetId: string,
  sharingType: SnippetSharingType,
  shares: SnippetShareInput[] | undefined
) {
  return guard(
    async () => {
      assertSupportedShareGrantees(shares ?? [])

      const snippet = await db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, snippetId),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.createdById, userId),
          eq(schema.Snippet.isDeleted, false)
        ),
      })

      if (!snippet) {
        throw new NotFoundError('Snippet not found or you do not have permission to share it')
      }

      if (snippet.systemType != null) {
        throw new ForbiddenError('System snippets cannot be modified')
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schema.Snippet)
          .set({ sharingType, updatedAt: new Date() })
          .where(eq(schema.Snippet.id, snippetId))

        if (sharingType === SnippetSharingType.GROUPS) {
          // One pass per supported kind, driven by the list — including kinds with
          // zero incoming shares, whose call is what CLEARS previously stored rows.
          for (const granteeType of SNIPPET_SHARE_GRANTEE_TYPES) {
            await setInstanceAccess(
              { db: tx, organizationId, userId },
              toRecordId(BuiltInEntityType.snippet, snippetId),
              granteeType,
              (shares ?? [])
                .filter((s) => s.granteeType === granteeType)
                .map((s) => ({
                  granteeId: s.granteeId,
                  permission:
                    s.permission === 'EDIT' ? ResourcePermission.edit : ResourcePermission.view,
                }))
            )
          }
        } else {
          await tx
            .delete(schema.ResourceAccess)
            .where(
              and(
                eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.snippet),
                eq(schema.ResourceAccess.entityInstanceId, snippetId)
              )
            )
        }
      })
    },
    'Error sharing snippet',
    { snippetId }
  )
}

/** Increment a snippet's usage counter (best-effort, org-scoped). */
export async function incrementSnippetUsage(
  db: Database,
  organizationId: string,
  snippetId: string
) {
  return guard(
    async () => {
      await db
        .update(schema.Snippet)
        .set({ usageCount: sql`${schema.Snippet.usageCount} + 1` })
        .where(
          and(
            eq(schema.Snippet.id, snippetId),
            eq(schema.Snippet.organizationId, organizationId),
            eq(schema.Snippet.isDeleted, false)
          )
        )
    },
    'Error incrementing snippet usage',
    { snippetId }
  )
}
