// packages/lib/src/snippets/snippet-queries.ts

import { type Database, schema } from '@auxx/database'
import { BuiltInEntityType, SnippetSharingType } from '@auxx/database/enums'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { getInstanceAccess, getUserAccessibleInstances } from '../resource-access'
import { guard } from './guard'
import { resolveCanEdit } from './snippet-permissions'

export interface ListSnippetsFilters {
  folderId?: string
  searchQuery?: string
  includeShared: boolean
}

/**
 * List the snippets visible to a user (own + org-shared + group/instance-shared),
 * with a per-snippet share count merged in. Replaces the `all` router query.
 */
export async function listSnippetsForUser(
  db: Database,
  organizationId: string,
  userId: string,
  filters: ListSnippetsFilters
) {
  return guard(async () => {
    const { folderId, searchQuery, includeShared } = filters

    const where: SQL[] = [
      eq(schema.Snippet.organizationId, organizationId),
      eq(schema.Snippet.isDeleted, false),
      // System-seeded snippets (quote_email/invoice_email) are read-only and
      // fetched only via `getSystemSnippet` — never surfaced in the library
      // list or the composer `/`-menu (both backed by this query).
      isNull(schema.Snippet.systemType),
    ]

    if (folderId) {
      where.push(eq(schema.Snippet.folderId, folderId))
    }

    if (searchQuery) {
      where.push(
        or(
          ilike(schema.Snippet.title, `%${searchQuery}%`),
          ilike(schema.Snippet.content, `%${searchQuery}%`)
        )!
      )
    }

    if (includeShared) {
      const accessResult = await getUserAccessibleInstances(
        { db, organizationId, userId },
        userId,
        BuiltInEntityType.snippet
      )

      if (accessResult.hasTypeAccess) {
        // Org admin: own + org-shared + group-shared
        where.push(
          or(
            eq(schema.Snippet.createdById, userId),
            eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
            eq(schema.Snippet.sharingType, SnippetSharingType.GROUPS)
          )!
        )
      } else {
        const sharedSnippetIds = accessResult.instances.map(
          (a) => parseRecordId(a.recordId).entityInstanceId
        )
        where.push(
          or(
            eq(schema.Snippet.createdById, userId),
            eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
            sharedSnippetIds.length > 0 ? inArray(schema.Snippet.id, sharedSnippetIds) : sql`false`
          )!
        )
      }
    } else {
      where.push(eq(schema.Snippet.createdById, userId))
    }

    const snippets = await db.query.Snippet.findMany({
      where: and(...where),
      with: {
        folder: true,
        createdBy: { columns: { id: true, name: true, email: true, image: true } },
      },
      orderBy: [desc(schema.Snippet.updatedAt)],
    })

    const snippetIds = snippets.map((s) => s.id)
    const sharesCounts =
      snippetIds.length > 0
        ? await db
            .select({
              snippetId: schema.ResourceAccess.entityInstanceId,
              count: count(schema.ResourceAccess.id),
            })
            .from(schema.ResourceAccess)
            .where(
              and(
                eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.snippet),
                inArray(schema.ResourceAccess.entityInstanceId, snippetIds)
              )
            )
            .groupBy(schema.ResourceAccess.entityInstanceId)
        : []

    return snippets.map((snippet) => ({
      ...snippet,
      _count: {
        shares: sharesCounts.find((c) => c.snippetId === snippet.id)?.count ?? 0,
      },
    }))
  }, 'Error getting snippets')
}

/**
 * Fetch a single snippet the user is allowed to see, plus its share grants and
 * whether the user may edit it. Replaces the `byId` router query.
 */
export async function getSnippetWithAccess(
  db: Database,
  organizationId: string,
  userId: string,
  snippetId: string
) {
  return guard(
    async () => {
      const accessResult = await getUserAccessibleInstances(
        { db, organizationId, userId },
        userId,
        BuiltInEntityType.snippet
      )
      const sharedSnippetIds = accessResult.instances.map(
        (a) => parseRecordId(a.recordId).entityInstanceId
      )

      const snippet = await db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, snippetId),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false),
          // System snippets are fetched only by `getSystemSnippet`, never by id from the UI.
          isNull(schema.Snippet.systemType),
          or(
            eq(schema.Snippet.createdById, userId),
            eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
            accessResult.hasTypeAccess
              ? sql`true`
              : sharedSnippetIds.includes(snippetId)
                ? sql`true`
                : sql`false`
          )!
        ),
        with: {
          folder: true,
          createdBy: { columns: { id: true, name: true, email: true, image: true } },
        },
      })

      if (!snippet) {
        throw new NotFoundError('Snippet not found')
      }

      const shares = await getInstanceAccess(
        { db, organizationId },
        toRecordId(BuiltInEntityType.snippet, snippetId)
      )

      const canEdit = await resolveCanEdit(organizationId, userId, snippet.createdById, shares)

      return { snippet: { ...snippet, shares }, canEdit }
    },
    'Error getting snippet',
    { snippetId }
  )
}

/**
 * List all snippet folders for an organization with a per-folder snippet count.
 * Replaces the `getFolders` router query.
 */
export async function listSnippetFoldersWithCounts(db: Database, organizationId: string) {
  return guard(async () => {
    const folders = await db.query.SnippetFolder.findMany({
      where: eq(schema.SnippetFolder.organizationId, organizationId),
      with: { subfolders: true },
      orderBy: [asc(schema.SnippetFolder.name)],
    })

    const folderIds = folders.map((f) => f.id)
    const snippetCounts =
      folderIds.length > 0
        ? await db
            .select({
              folderId: schema.Snippet.folderId,
              count: count(schema.Snippet.id),
            })
            .from(schema.Snippet)
            .where(
              and(inArray(schema.Snippet.folderId, folderIds), eq(schema.Snippet.isDeleted, false))
            )
            .groupBy(schema.Snippet.folderId)
        : []

    return folders.map((folder) => ({
      ...folder,
      _count: {
        snippets: snippetCounts.find((c) => c.folderId === folder.id)?.count ?? 0,
      },
    }))
  }, 'Error getting snippet folders')
}
