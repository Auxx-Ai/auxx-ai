// packages/lib/src/email/labels/label-sync.ts

import { type Database, schema } from '@auxx/database'
import { LabelType } from '@auxx/database/enums'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from './guard'
import type { ProviderLabel } from './label-provider.interface'
import { createLabelProvider } from './label-provider-factory'
import { listLabels } from './label-queries'
import type {
  LabelEntity,
  LabelInsert,
  ProviderLabelDiff,
  SyncAllResult,
  SyncIntegrationParams,
} from './types'

/**
 * The provider↔DB label reconciler. **No permission checks** — the router
 * asserts `requireChannelManageAccess` (per-integration) or `channelsManage`
 * (fan-out) first.
 */

/**
 * Compare a provider's label set against ours and say what to write.
 *
 * Extracted as a **pure** function — no `db`, no provider, no clock — because it
 * is the part of sync most likely to break in a port and the only part worth
 * unit-testing. See `__tests__/label-sync.test.ts`.
 *
 * The `|| null` normalizations are load-bearing, not cosmetic: the DB stores
 * absent colors as `NULL` while the provider reports them as `undefined`, so
 * comparing them raw makes every uncolored label look changed and every sync
 * rewrite every row forever. Same for `?? true` on `visible`, which the DB
 * defaults to `true`.
 *
 * @param providerLabels labels as reported by `LabelProvider.getLabels()`
 * @param dbLabels our rows for the SAME org + integration (the caller scopes)
 */
export function diffProviderLabels(
  providerLabels: ProviderLabel[],
  dbLabels: LabelEntity[]
): ProviderLabelDiff {
  const providerIds = new Set(providerLabels.map((label) => label.id))
  const dbByProviderId = new Map(dbLabels.map((label) => [label.labelId, label]))

  const diff: ProviderLabelDiff = { toCreate: [], toUpdate: [], toDelete: [] }

  for (const providerLabel of providerLabels) {
    const backgroundColor = providerLabel.backgroundColor || null
    const textColor = providerLabel.textColor || null
    const isVisible = providerLabel.visible ?? true

    const dbLabel = dbByProviderId.get(providerLabel.id)

    if (!dbLabel) {
      diff.toCreate.push({
        labelId: providerLabel.id,
        name: providerLabel.name,
        // Anything the provider does not explicitly call 'system' is a user
        // label — a provider-specific string we don't recognise must not be
        // written into the `LabelType` pg enum.
        type: providerLabel.type === 'system' ? LabelType.system : LabelType.user,
        backgroundColor,
        textColor,
        isVisible,
      })
      continue
    }

    if (
      dbLabel.name !== providerLabel.name ||
      dbLabel.backgroundColor !== backgroundColor ||
      dbLabel.textColor !== textColor ||
      dbLabel.isVisible !== isVisible
    ) {
      diff.toUpdate.push({
        id: dbLabel.id,
        name: providerLabel.name,
        backgroundColor,
        textColor,
        isVisible,
      })
    }
  }

  for (const dbLabel of dbLabels) {
    if (!providerIds.has(dbLabel.labelId)) {
      diff.toDelete.push(dbLabel.id)
    }
  }

  return diff
}

/**
 * Reconcile one integration's labels against its provider and return the result.
 *
 * The three write sets run in **one transaction**. Previously they were three
 * unbatched `Promise.all` fan-outs with no transaction, so a failure partway
 * through left the label set half-diffed — e.g. deletions applied but the
 * matching creates lost, which then read as "the user deleted those labels".
 * Inserts are one multi-row statement and deletes one `inArray`; updates stay
 * per-row because each carries a distinct `SET` payload.
 */
export async function syncIntegrationLabels(
  db: Database,
  organizationId: string,
  params: SyncIntegrationParams
): Promise<Result<LabelEntity[], Error>> {
  const { integrationType, integrationId } = params

  return guard(
    async () => {
      const provider = await createLabelProvider(organizationId, integrationId, integrationType)
      const providerLabels = await provider.getLabels()

      const existing = await listLabels(db, organizationId, { integrationType, integrationId })
      if (existing.isErr()) throw existing.error

      const { toCreate, toUpdate, toDelete } = diffProviderLabels(providerLabels, existing.value)
      const now = new Date()

      if (toCreate.length > 0 || toUpdate.length > 0 || toDelete.length > 0) {
        await db.transaction(async (tx) => {
          if (toCreate.length > 0) {
            const rows: LabelInsert[] = toCreate.map((row) => ({
              ...row,
              organizationId,
              integrationType,
              integrationId,
              updatedAt: now,
            }))
            await tx.insert(schema.Label).values(rows)
          }

          for (const row of toUpdate) {
            await tx
              .update(schema.Label)
              .set({
                name: row.name,
                backgroundColor: row.backgroundColor,
                textColor: row.textColor,
                isVisible: row.isVisible,
                updatedAt: now,
              })
              .where(
                and(eq(schema.Label.id, row.id), eq(schema.Label.organizationId, organizationId))
              )
          }

          if (toDelete.length > 0) {
            await tx
              .delete(schema.Label)
              .where(
                and(
                  inArray(schema.Label.id, toDelete),
                  eq(schema.Label.organizationId, organizationId)
                )
              )
          }
        })
      }

      const refreshed = await listLabels(db, organizationId, { integrationType, integrationId })
      if (refreshed.isErr()) throw refreshed.error
      return refreshed.value
    },
    'Error syncing integration labels',
    { integrationId, integrationType }
  )
}

/**
 * Reconcile every live integration in the org, reporting each one separately.
 *
 * Two fixes over `LabelService.syncAllLabels`:
 *
 * 1. **One bad integration no longer fails the batch.** The old `Promise.all`
 *    over `syncLabels` rejected wholesale on the first error, so a single expired
 *    Gmail token blanked the response for every other integration. Each element
 *    is now a discriminated `{ ok: true, labels } | { ok: false, error }`, so the
 *    caller can show "3 synced, 1 needs reconnecting" instead of a bare failure.
 *    `Promise.all` is safe here precisely because `syncIntegrationLabels` returns
 *    a `Result` and cannot reject.
 * 2. **Soft-deleted integrations are excluded** (`isNull(Integration.deletedAt)`).
 *    Without it this called the provider for disconnected channels, which is both
 *    guaranteed to fail and — before fix 1 — enough to fail everything else.
 *
 * The outer `Result` covers only the integration list query; per-integration
 * failures live inside the array.
 */
export async function syncAllIntegrationLabels(
  db: Database,
  organizationId: string
): Promise<Result<SyncAllResult, Error>> {
  return guard(async () => {
    const integrations = await db
      .select({ id: schema.Integration.id, provider: schema.Integration.provider })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          isNull(schema.Integration.deletedAt)
        )
      )

    if (integrations.length === 0) return []

    return Promise.all(
      integrations.map(async ({ id, provider }) => {
        const result = await syncIntegrationLabels(db, organizationId, {
          integrationType: provider,
          integrationId: id,
        })

        return result.isErr()
          ? { integrationId: id, provider, ok: false as const, error: result.error.message }
          : { integrationId: id, provider, ok: true as const, labels: result.value }
      })
    )
  }, 'Error syncing all integration labels')
}
