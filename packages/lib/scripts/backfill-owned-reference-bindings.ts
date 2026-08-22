// packages/lib/scripts/backfill-owned-reference-bindings.ts
//
// One-off repair for the owned-binder rootPath defect (plans/products/README.md,
// "Verify before building"): `projectConnectorOwnedTargets` used to emit the ABSOLUTE
// manifest rootPath (`line_items[].product_id`) while `seedAppOwnedMappings` stores the
// PARENT-RELATIVE form (`product_id`), and the install-time binder matches with `===` —
// so any owned mapping nested under a non-empty parent rootPath never got its
// `entityDefinitionId` bound at template install, even though the def exists. Confirmed
// live: both dev Shopify connectors carry `product_id` / `variant_id` reference
// mappings with `entityDefinitionId: NULL`, so 15 synced `shopify_line_items` have
// 0 Product/Variant edges.
//
// The code fix (relativize in the projector via `storedRootPath`) repairs future
// installs only. This script repairs EXISTING connectors: it finds app-owned mappings
// with `entityDefinitionId IS NULL` whose deployed catalog declares a matching target
// (compared against the RELATIVIZED rootPath) AND whose owned def is already installed
// for the same app installation, then binds them exactly the way the fixed binder
// would — set `entityDefinitionId` + repoint the late-bound `@app:` field refs at the
// installed def's actual apiSlug. Writes go through `updateMapping`, so the standard
// edit safety runs (the def change stamps `resyncPending: rebind`; the mapping never
// synced, so there are no items to neutralize).
//
// Idempotent — a bound mapping (`entityDefinitionId` set) is never touched again.
// DRY-RUN by default; pass --write to apply.
//
// NOTE: binding alone does NOT create the missing edges on already-synced rows. After
// --write, re-crawl the affected connector: the stamped `resyncPending` surfaces the
// "Backfill now" banner (tRPC `dataConnector.backfillPendingChange`), or run
// packages/lib/scripts/backfill-pending-connector-change.ts with CONNECTOR_ID/ORG_ID.
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-owned-reference-bindings.ts [--write]

import { type CatalogPayload, database as db, schema } from '@auxx/database'
import { parseAppFieldRef, toAppFieldRef } from '@auxx/types/field'
import { and, eq, isNull } from 'drizzle-orm'
import { projectConnectorOwnedTargets, updateMapping } from '../src/data-connectors/mutations'
import type { FieldMapping } from '../src/data-connectors/types'

const WRITE = process.argv.includes('--write')

/**
 * Repoint an owned mapping's late-bound `@app:` refs at the installed def's ACTUAL
 * apiSlug (it may carry a slug-conflict suffix) — mirror of the web binder's
 * `rebindFieldMappings`. Refs stay late-bound; non-`@app:` and other-app refs pass
 * through.
 */
function rebindFieldMappings(
  fieldMappings: FieldMapping[],
  appSlug: string,
  installedApiSlug: string
): FieldMapping[] {
  return fieldMappings.map((fm) => {
    const parts = fm.targetFieldRef ? parseAppFieldRef(fm.targetFieldRef) : null
    if (!parts || parts.appSlug !== appSlug) return fm
    return { ...fm, targetFieldRef: toAppFieldRef(installedApiSlug, appSlug, parts.appFieldKey) }
  })
}

async function main() {
  const connectors = await db.query.DataConnector.findMany({
    where: eq(schema.DataConnector.definitionKind, 'app'),
  })
  console.log(`${WRITE ? 'WRITE' : 'DRY-RUN'} — ${connectors.length} app connectors`)

  let bound = 0
  let skipped = 0
  let failed = 0

  for (const connector of connectors) {
    const orgId = connector.organizationId
    const label = `org ${orgId} connector ${connector.id} (${connector.name})`
    try {
      if (!connector.appInstallationId || !connector.type.startsWith('app:')) {
        console.log(`${label}: no app installation — skipping`)
        continue
      }
      const appSlug = connector.type.slice('app:'.length)

      // The deployed catalog for this connector's installation (same resolution the
      // ownedTargets router uses: the installation's current deployment, first declared
      // connector).
      const installation = await db.query.AppInstallation.findFirst({
        where: eq(schema.AppInstallation.id, connector.appInstallationId),
        columns: { currentDeploymentId: true },
      })
      const deployment = installation?.currentDeploymentId
        ? await db.query.AppDeployment.findFirst({
            where: eq(schema.AppDeployment.id, installation.currentDeploymentId),
            columns: { catalog: true },
          })
        : null
      const catalog = (deployment?.catalog as CatalogPayload | null)?.dataConnectors?.[0]
      if (!catalog) {
        console.log(`${label}: no deployed catalog connector — skipping`)
        continue
      }

      // Post-fix projection: rootPaths are RELATIVIZED, matching the stored rows.
      const targets = projectConnectorOwnedTargets(appSlug, catalog)

      const streams = await db.query.DataConnectorStream.findMany({
        where: and(
          eq(schema.DataConnectorStream.dataConnectorId, connector.id),
          eq(schema.DataConnectorStream.organizationId, orgId)
        ),
      })
      const streamByKey = new Map(streams.map((s) => [s.streamKey, s]))

      for (const target of targets) {
        const stream = streamByKey.get(target.streamKey)
        if (!stream) continue
        const mapping = await db.query.DataConnectorMapping.findFirst({
          where: and(
            eq(schema.DataConnectorMapping.dataConnectorStreamId, stream.id),
            eq(schema.DataConnectorMapping.organizationId, orgId),
            eq(schema.DataConnectorMapping.targetMode, 'owned'),
            eq(schema.DataConnectorMapping.rootPath, target.rootPath),
            isNull(schema.DataConnectorMapping.entityDefinitionId)
          ),
        })
        if (!mapping) continue // already bound, or no such row — nothing to repair

        // The installed def for this owned record type under the SAME app install —
        // the strict adopt key (`sourceKey === ownedKey`), as `adoptSharedOwnedDefId`.
        const def = await db.query.EntityDefinition.findFirst({
          where: and(
            eq(schema.EntityDefinition.organizationId, orgId),
            eq(schema.EntityDefinition.appInstallationId, connector.appInstallationId),
            eq(schema.EntityDefinition.sourceKey, target.ownedKey),
            isNull(schema.EntityDefinition.archivedAt)
          ),
          columns: { id: true, apiSlug: true },
        })
        if (!def) {
          skipped++
          console.log(
            `${label}: stream '${target.streamKey}' rootPath '${target.rootPath}' → def ` +
              `'${target.ownedKey}' not installed — leaving unbound (binds at template install)`
          )
          continue
        }

        const fieldMappings = rebindFieldMappings(
          (mapping.fieldMappings ?? []) as FieldMapping[],
          appSlug,
          def.apiSlug
        )
        console.log(
          `${label}: stream '${target.streamKey}' rootPath '${target.rootPath}' → bind to ` +
            `${def.id} (${def.apiSlug})${WRITE ? '' : ' [dry-run]'}`
        )
        if (WRITE) {
          await updateMapping(db, orgId, mapping.id, {
            entityDefinitionId: def.id,
            fieldMappings,
          })
        }
        bound++
      }
    } catch (error) {
      failed++
      console.error(`${label}: FAILED`, error)
    }
  }

  console.log(
    `\nDone. ${bound} mapping(s) ${WRITE ? 'bound' : 'would be bound'}, ` +
      `${skipped} skipped (def not installed), ${failed} connector(s) failed.`
  )
  if (WRITE && bound > 0) {
    console.log(
      'Reminder: already-synced rows still lack their edges — trigger the "Backfill now" ' +
        're-crawl per connector (resyncPending is stamped), e.g. ' +
        'scripts/backfill-pending-connector-change.ts.'
    )
  }
  process.exit(failed > 0 ? 1 : 0)
}

void main()
