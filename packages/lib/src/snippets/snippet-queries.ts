// packages/lib/src/snippets/snippet-queries.ts

import { type Database, schema } from '@auxx/database'
import { BuiltInEntityType, ResourceGranteeType } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, asc, count, desc, eq, ilike, inArray, isNull, not, or, type SQL } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import type { InstanceListScope } from '../permissions/capabilities/entity-access'
import { getInstanceAccess } from '../resource-access'
import { guard } from './guard'

export interface ListSnippetsFilters {
  folderId?: string
  searchQuery?: string
  /** `false` narrows to the caller's OWN snippets on top of the visible set. */
  includeShared: boolean
}

/**
 * Translate the caller's pre-computed {@link InstanceListScope} into a `WHERE`
 * fragment on `Snippet.id`, so the visible set is applied by the DATABASE rather
 * than by filtering rows after they are read (plan 36 §6.1).
 *
 * `'none'` returns `null` and the caller must skip the query entirely — a
 * `sql\`false\`` predicate would work too, but a caller that has to branch anyway
 * should not pay for the roundtrip.
 *
 * `snippet` is `baselineAtCreate: true`, so in practice this is the `'include'`
 * arm for everyone except OWNER (who gets `'exclude'` with an empty list, i.e.
 * no filter at all). Both arms are handled so the helper stays honest if the
 * resource's posture ever changes.
 */
function scopeFilter(scope: InstanceListScope): SQL | undefined | null {
  if (scope.kind === 'none') return null
  if (scope.kind === 'include') return inArray(schema.Snippet.id, scope.includeIds)
  return scope.excludeIds.length > 0 ? not(inArray(schema.Snippet.id, scope.excludeIds)) : undefined
}

/**
 * List the snippets the caller may VIEW, with a per-snippet share count merged in.
 *
 * `scope` comes from `privateInstanceListScope(caps, 'snippet')` and is applied
 * BEFORE the read — there is no post-filter pass, so the returned set is exactly
 * what {@link import('../permissions/capabilities/capability-set').CapabilitySet}
 * `.canViewInstance('snippet', id)` would allow one id at a time.
 *
 * There is deliberately **no org-admin arm**. The old `hasTypeAccess` branch
 * handed admins every snippet in the org; per plan 36 decision 0.6 only OWNER
 * short-circuits, and that happens inside the scope computation.
 */
export async function listSnippetsForUser(
  db: Database,
  organizationId: string,
  userId: string,
  scope: InstanceListScope,
  filters: ListSnippetsFilters
) {
  return guard(async () => {
    const { folderId, searchQuery, includeShared } = filters

    const scoped = scopeFilter(scope)
    if (scoped === null) return []

    const where: SQL[] = [
      eq(schema.Snippet.organizationId, organizationId),
      eq(schema.Snippet.isDeleted, false),
      // System-seeded snippets (quote_email/invoice_email) are read-only and
      // fetched only via `getSystemSnippet` — never surfaced in the library
      // list or the composer `/`-menu (both backed by this query).
      isNull(schema.Snippet.systemType),
    ]

    if (scoped) where.push(scoped)
    if (!includeShared) where.push(eq(schema.Snippet.createdById, userId))
    if (folderId) where.push(eq(schema.Snippet.folderId, folderId))

    if (searchQuery) {
      where.push(
        or(
          ilike(schema.Snippet.title, `%${searchQuery}%`),
          ilike(schema.Snippet.content, `%${searchQuery}%`)
        )!
      )
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
    const shareRows =
      snippetIds.length > 0
        ? await db
            .select({
              snippetId: schema.ResourceAccess.entityInstanceId,
              granteeType: schema.ResourceAccess.granteeType,
              granteeId: schema.ResourceAccess.granteeId,
            })
            .from(schema.ResourceAccess)
            .where(
              and(
                eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.snippet),
                inArray(schema.ResourceAccess.entityInstanceId, snippetIds)
              )
            )
        : []

    return snippets.map((snippet) => ({
      ...snippet,
      _count: {
        // The owner's own `admin` row is written at create (`baselineAtCreate: true`),
        // so counting raw rows would report every private snippet as "shared with 1".
        // Count the grants to OTHERS.
        shares: shareRows.filter(
          (row) =>
            row.snippetId === snippet.id &&
            !(row.granteeType === ResourceGranteeType.user && row.granteeId === snippet.createdById)
        ).length,
      },
    }))
  }, 'Error getting snippets')
}

/**
 * Fetch one snippet plus its `ResourceAccess` grants.
 *
 * **Carries no access check of its own** — the caller has already asserted
 * `view` on this exact id through `snippet-instance-access.ts`. The only
 * filtering here is identity: org scope, not soft-deleted, and not a system
 * snippet (those are reachable only through `getSystemSnippet`).
 */
export async function getSnippetWithShares(
  db: Database,
  organizationId: string,
  userId: string,
  snippetId: string
) {
  return guard(
    async () => {
      const snippet = await db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, snippetId),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false),
          isNull(schema.Snippet.systemType)
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
        { db, organizationId, userId },
        toRecordId(BuiltInEntityType.snippet, snippetId)
      )

      return { snippet: { ...snippet, shares } }
    },
    'Error getting snippet',
    { snippetId }
  )
}

/**
 * List the org's snippet folders with a per-folder snippet count.
 *
 * Folders stay FLAT LABELS with no per-folder grants (plan 36 decision 0.4), so
 * the folder rows themselves are unfiltered — but the counts are scoped to the
 * snippets the caller may view. An unscoped count leaks the existence (and
 * volume) of other members' private snippets, which was the state before plan 36.
 */
export async function listSnippetFoldersWithCounts(
  db: Database,
  organizationId: string,
  scope: InstanceListScope
) {
  return guard(async () => {
    const folders = await db.query.SnippetFolder.findMany({
      where: eq(schema.SnippetFolder.organizationId, organizationId),
      with: { subfolders: true },
      orderBy: [asc(schema.SnippetFolder.name)],
    })

    const folderIds = folders.map((f) => f.id)
    const scoped = scopeFilter(scope)
    const snippetCounts =
      folderIds.length > 0 && scoped !== null
        ? await db
            .select({
              folderId: schema.Snippet.folderId,
              count: count(schema.Snippet.id),
            })
            .from(schema.Snippet)
            .where(
              and(
                inArray(schema.Snippet.folderId, folderIds),
                eq(schema.Snippet.organizationId, organizationId),
                eq(schema.Snippet.isDeleted, false),
                isNull(schema.Snippet.systemType),
                ...(scoped ? [scoped] : [])
              )
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
