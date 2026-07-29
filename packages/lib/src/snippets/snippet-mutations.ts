// packages/lib/src/snippets/snippet-mutations.ts

import { type Database, schema } from '@auxx/database'
import { BuiltInEntityType, ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { and, eq, sql } from 'drizzle-orm'
import { AuxxError, BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { emitResourceAccessInstanceChanged } from '../resource-access'
import { guard } from './guard'

/**
 * Snippet write paths. **None of them carry an access check.**
 *
 * Since plan 36 every caller asserts per-instance access first
 * (`assertSnippetAccess` → `CapabilitySet.assert{View,Edit,Admin}Instance`), so
 * the hand-rolled creator/user/profile/group resolution that used to live in
 * `snippet-permissions.ts` is gone — it duplicated the shared grantee builder in
 * memory and its own doc comment warned it would drift. The only guards left
 * here are identity/integrity ones: org scope, soft-delete, system snippets,
 * folder ownership.
 *
 * Sharing is NOT here either: it funnels through `resourceAccess.grantInstance`
 * → `grantInstanceAccess`, like every other shareable resource, which authorizes
 * on `assertAdminInstance('snippet', id)` and carries the notification/audit
 * behavior a bespoke writer would have had to re-implement.
 */

const SNIPPET_KEY = BuiltInEntityType.snippet

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
}

/**
 * Create a snippet, private to its author.
 *
 * `snippet` is `baselineAtCreate: true`, so the owner's `admin` `ResourceAccess`
 * row is written in the SAME transaction as the row itself — without it the
 * author cannot see the snippet they just created (there is no area-level
 * fallback for this resource). Dashboards' `insertInstanceAccessBaseline` is the
 * precedent; snippets write only the owner row and no `role:org_member`
 * baseline, because a snippet starts as personal scratch content and SHARING is
 * the opt-in (plan 36 §0.2).
 *
 * The cache bust runs AFTER the transaction commits, for the same reason
 * dashboards does it there: `restrictedInstanceIds` / `userCapabilities` must
 * not be repopulated from a snapshot taken mid-transaction.
 */
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

    const snippetId = await db.transaction(async (tx) => {
      const [snippet] = await tx
        .insert(schema.Snippet)
        .values({
          title: input.title,
          content: input.content,
          contentHtml: input.contentHtml,
          description: input.description,
          folderId: input.folderId,
          organizationId,
          createdById: userId,
          updatedAt: new Date(),
        })
        .returning({ id: schema.Snippet.id })
      if (!snippet) throw new AuxxError('Snippet insert returned no row')

      await tx
        .insert(schema.ResourceAccess)
        .values({
          organizationId,
          entityDefinitionId: SNIPPET_KEY,
          entityInstanceId: snippet.id,
          granteeType: ResourceGranteeType.user,
          granteeId: userId,
          permission: ResourcePermission.admin,
          grantedById: userId,
        })
        .onConflictDoNothing()

      return snippet.id
    })

    await emitResourceAccessInstanceChanged(organizationId, [
      { granteeType: ResourceGranteeType.user, granteeId: userId },
    ])

    return db.query.Snippet.findFirst({
      where: eq(schema.Snippet.id, snippetId),
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
}

/** Update a snippet's content. Access is the caller's to assert (`edit`). */
export async function updateSnippet(
  db: Database,
  organizationId: string,
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

      if (input.folderId) {
        await assertFolderInOrg(db, organizationId, input.folderId)
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (input.title !== undefined) updateData.title = input.title
      if (input.content !== undefined) updateData.content = input.content
      if (input.contentHtml !== undefined) updateData.contentHtml = input.contentHtml
      if (input.description !== undefined) updateData.description = input.description
      if (input.folderId !== undefined) updateData.folderId = input.folderId

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

/**
 * Soft-delete a snippet. Access is the caller's to assert (`admin`).
 *
 * The old `role === 'ADMIN' || 'OWNER'` escape hatch is gone: per plan 36
 * decision 0.6 there is no admin override on instance access, and OWNER already
 * short-circuits inside `effectiveInstanceLevel`.
 */
export async function deleteSnippet(db: Database, organizationId: string, snippetId: string) {
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

      await db
        .update(schema.Snippet)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(schema.Snippet.id, snippetId))
    },
    'Error deleting snippet',
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
