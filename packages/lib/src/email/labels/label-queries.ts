// packages/lib/src/email/labels/label-queries.ts

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { ChannelManageScope } from '../../channels/manage-access'
import { NotFoundError } from '../../errors'
import { guard } from './guard'
import type { LabelEntity, ListLabelsFilters } from './types'

/**
 * Label reads. **None of them carry a permission check** — the router asserts
 * `requireChannelManageAccess` (or `inboxesView` for the thread lens) and then
 * calls. The only guards here are identity/integrity ones: org scope, and
 * not-found (module guide §6).
 */

/**
 * Turn the caller's pre-computed manage-authority allowlist into a `WHERE`
 * fragment on `Label.integrationId`.
 *
 * The empty-`ids` case returns `sql\`false\`` rather than `undefined`. Dropping
 * an empty `inArray` is the classic footgun that turns "sees nothing" into "sees
 * everything" — a user with no manageable channels would get the org's whole
 * label set.
 */
function scopeFilter(scope: ChannelManageScope | undefined): SQL | undefined {
  if (!scope || scope.kind === 'all') return undefined
  if (scope.integrationIds.length === 0) return sql`false`
  return inArray(schema.Label.integrationId, scope.integrationIds)
}

/**
 * List the org's labels, optionally narrowed to one integration and/or to the
 * channels the caller may manage.
 *
 * One function replaces `LabelService.getAllLabels`, `LabelService.getLabels`,
 * `LabelRepo.findAll` **and the three verbatim copies of this query that were
 * inlined in the router** — they differed only in which filters they applied.
 *
 * `LabelService.getLabels` also built a provider it never used, which made every
 * list an accidental credential probe whose sole observable effect was throwing
 * `ReauthenticationRequiredError` on an expired token. That is gone: listing
 * labels reads the DB and nothing else.
 */
export async function listLabels(
  db: Database,
  organizationId: string,
  filters: ListLabelsFilters = {}
): Promise<Result<LabelEntity[], Error>> {
  return guard(async () => {
    const where: SQL[] = [eq(schema.Label.organizationId, organizationId)]

    if (filters.integrationType) {
      where.push(eq(schema.Label.integrationType, filters.integrationType))
    }
    if (filters.integrationId) {
      where.push(eq(schema.Label.integrationId, filters.integrationId))
    }

    const scoped = scopeFilter(filters.scope)
    if (scoped) where.push(scoped)

    return db
      .select()
      .from(schema.Label)
      .where(and(...where))
      .orderBy(asc(schema.Label.name))
  }, 'Error listing labels')
}

/**
 * Resolve one label by PK **within the org**, throwing {@link NotFoundError}
 * when it does not exist or belongs to another org.
 *
 * Exported as a throwing helper (not a `Result`) so mutation bodies can use it
 * as a precondition inside their own `guard()`; {@link getLabelById} is the
 * `Result`-returning wrapper for callers outside a guarded body.
 *
 * The org predicate is the point. Every previous id lookup
 * (`updateLabel`/`deleteLabel`/`addLabelToThread`/`removeLabelFromThread`/
 * `toggleLabelVisibility`) selected on `eq(Label.id, labelId)` alone and then
 * handed the row's provider-side `labelId` to a provider client built for the
 * *caller's* org — a cross-org id was enough to read a foreign label's name and
 * mutate the caller's own mailbox with it.
 */
export async function requireLabel(
  db: Database,
  organizationId: string,
  labelId: string
): Promise<LabelEntity> {
  const [label] = await db
    .select()
    .from(schema.Label)
    .where(and(eq(schema.Label.id, labelId), eq(schema.Label.organizationId, organizationId)))
    .limit(1)

  if (!label) throw new NotFoundError('Label not found')
  return label
}

/**
 * Org-scoped fetch of one label.
 *
 * The router calls this **before** authorizing on `label.integrationId`, so a
 * foreign-org id 404s rather than leaking its existence through a 403 (the
 * ordering #1396 established for `toggleLabelEnabled`).
 */
export async function getLabelById(
  db: Database,
  organizationId: string,
  labelId: string
): Promise<Result<LabelEntity, Error>> {
  return guard(() => requireLabel(db, organizationId, labelId), 'Error getting label', { labelId })
}

/**
 * Find a label by the id the *provider* assigned it, within one integration.
 *
 * Ported from `LabelRepo.findByProviderLabelId`, which has **no callers today**
 * (plan decision D4: port rather than drop — it is the natural lookup for
 * reconciling a webhook payload against our rows, and deleting it would just get
 * it rewritten). Returns `ok(null)` for "no such label" because absence is a
 * normal answer here, unlike {@link getLabelById}.
 */
export async function findLabelByProviderId(
  db: Database,
  organizationId: string,
  integrationType: string,
  integrationId: string,
  providerLabelId: string
): Promise<Result<LabelEntity | null, Error>> {
  return guard(
    async () => {
      const [label] = await db
        .select()
        .from(schema.Label)
        .where(
          and(
            eq(schema.Label.organizationId, organizationId),
            eq(schema.Label.integrationType, integrationType),
            eq(schema.Label.integrationId, integrationId),
            eq(schema.Label.labelId, providerLabelId)
          )
        )
        .limit(1)

      return label ?? null
    },
    'Error finding label by provider id',
    { integrationId, providerLabelId }
  )
}

/**
 * List the labels applied to one thread.
 *
 * Adds the `organizationId` predicate the old join lacked — `getThreadLabels`
 * took a bare `threadId` and returned whatever was linked to it, in any org.
 * The hand-written 13-column projection is also gone: it enumerated every column
 * of `Label` and silently dropped the ones added since it was written
 * (`isSentBox`, `parentLabelId`, `providerCursor`, `pendingAction`,
 * `syncCheckpoint`), so selecting the table is both shorter and more correct.
 */
export async function listThreadLabels(
  db: Database,
  organizationId: string,
  threadId: string
): Promise<Result<LabelEntity[], Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({ label: schema.Label })
        .from(schema.Label)
        .innerJoin(
          schema.LabelsOnThread,
          and(
            eq(schema.LabelsOnThread.labelId, schema.Label.id),
            eq(schema.LabelsOnThread.threadId, threadId)
          )
        )
        .where(eq(schema.Label.organizationId, organizationId))
        .orderBy(asc(schema.Label.name))

      return rows.map((row) => row.label)
    },
    'Error listing thread labels',
    { threadId }
  )
}
