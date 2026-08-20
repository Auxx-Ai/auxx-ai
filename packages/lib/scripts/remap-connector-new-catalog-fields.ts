// packages/lib/scripts/remap-connector-new-catalog-fields.ts
//
// Bring an EXISTING app connector up to date with new catalog fields.
//
// Deploying an app version does NOT reach an already-created connector: the
// catalog → DataConnectorMapping projection is create-time only, and
// `rollForwardInstallations` touches only `defineFields` app fields + webhook bindings.
// So a new connector field produces no column, no mapping and therefore no value, ever
// — silently, not even on a full re-sync.
//
// Recovering that needs THREE things, and the platform has an entry point for none of
// them on an existing connector:
//
//   1. MATERIALIZE the new columns on the already-adopted owned defs. `installTemplates`
//      cannot do this: without `linkedEntities` it creates a NEW def (forking
//      `shopify_orders-2`), and with `linkedEntities` it skips field creation entirely
//      (`if (linkedEntities?.[template.id]) continue`). So this runs the installer's
//      Pass-3 logic itself, against the adopted def. `createCustomField` is idempotent
//      per `(owner, appFieldKey)`, so re-running is safe.
//   2. REFRESH the stream's stored `sourceSchema`, or the Map UI cannot even offer a
//      path it has no schema entry for.
//   3. ADD the field mappings, which is what actually makes a value get written.
//
// DRY RUN BY DEFAULT. Pass APPLY=1 to write.
//
// Usage: CONNECTOR_ID=… ORG_ID=… APP_SLUG=shopify [APPLY=1] npx tsx scripts/remap-connector-new-catalog-fields.ts

import { database as db, schema } from '@auxx/database'
import { createCustomField } from '@auxx/services/custom-fields'
import { toAppFieldRef } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { getCachedInstalledApps, getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { appCatalogStreamSchema } from '../src/data-connectors/app-catalog'
import {
  ownedParentRootPath,
  partitionOwnedFields,
  relativeSourcePath,
  updateMapping,
} from '../src/data-connectors/mutations'
import { projectAppConnectorTemplates } from '../src/entity-templates/app-template-projector'

const CONNECTOR_ID = process.env.CONNECTOR_ID ?? 't0e33r78tehnzcrbkqur0tcc'
const ORG_ID = process.env.ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const APP_SLUG = process.env.APP_SLUG ?? 'shopify'
const APPLY = process.env.APPLY === '1'

async function main() {
  console.log(`\n${APPLY ? '=== APPLY ===' : '=== DRY RUN (set APPLY=1 to write) ==='}\n`)

  const connector = await db.query.DataConnector.findFirst({
    where: (c, { eq: e }) => e(c.id, CONNECTOR_ID),
  })
  if (!connector) throw new Error(`No connector ${CONNECTOR_ID}`)
  const appInstallationId = connector.appInstallationId
  console.log(`connector "${connector.name}"  installation=${appInstallationId}`)

  // ── catalog ────────────────────────────────────────────────────────────────
  const installedApps = await getCachedInstalledApps(ORG_ID)
  const app =
    installedApps.find((a: any) => a.installationId === appInstallationId) ??
    installedApps.find((a: any) => a.app.slug === APP_SLUG)
  const catalog = (app as any)?.dataConnectors?.[0]
  if (!catalog) throw new Error(`No data connector catalog on installed app "${APP_SLUG}"`)
  console.log(`catalog streams: ${catalog.streams.map((s: any) => s.key).join(', ')}\n`)

  // ── 1. materialize columns on the adopted owned defs ───────────────────────
  const templates = projectAppConnectorTemplates(APP_SLUG, (app as any).app.title, catalog)
  console.log('── 1. columns ──────────────────────────────────────────────')

  let createdFields = 0
  for (const template of templates) {
    const sourceKey = template.entity.sourceKey ?? template.id
    // Same adoption key the connector seeder uses: (appInstallationId, sourceKey).
    const def = await db.query.EntityDefinition.findFirst({
      where: (d, { eq: e, and, isNull }) =>
        and(
          e(d.organizationId, ORG_ID),
          e(d.sourceKey, sourceKey),
          appInstallationId
            ? e(d.appInstallationId, appInstallationId)
            : isNull(d.appInstallationId)
        ),
    })
    if (!def) {
      console.log(`  ${template.entity.apiSlug}: NO ADOPTED DEF — skipped (nothing to add to)`)
      continue
    }

    const existing = await db.query.CustomField.findMany({
      where: (f, { eq: e }) => e(f.entityDefinitionId, def.id),
      columns: { appFieldKey: true },
    })
    const have = new Set(existing.map((f) => f.appFieldKey).filter(Boolean) as string[])
    const nonRel = template.fields.filter((f) => f.type !== 'RELATIONSHIP')
    const missing = nonRel.filter((f) => !have.has((f as any).appFieldKey))

    console.log(
      `  ${def.apiSlug} (${def.id}): ${have.size} existing, ${nonRel.length} declared, ${missing.length} MISSING`
    )
    for (const f of missing) {
      console.log(`      + ${(f as any).appFieldKey}  (${f.type})  "${f.name}"`)
      if (!APPLY) continue
      const { templateFieldId, ...fieldInput } = f as any
      const result = await createCustomField({
        ...fieldInput,
        organizationId: ORG_ID,
        entityDefinitionId: def.id,
        isCustom: true,
        appInstallationId: appInstallationId ?? fieldInput.appInstallationId,
        dataConnectorId: CONNECTOR_ID,
        systemAttribute: templateFieldId,
      })
      if (result.isOk()) createdFields++
      else console.log(`        ✖ ${JSON.stringify(result.error).slice(0, 200)}`)
    }
  }

  if (APPLY && createdFields > 0) {
    // A new column stays INVISIBLE to the sink until the org field cache is dropped:
    // `resolveConnectorFieldRef` → `buildWriteKeyToFieldId` → `getCachedCustomFields`,
    // and a stale `customFields` entry makes every new `@app:` ref unresolvable — the
    // whole run then fails setup with "unresolved target field refs". `entity-def.created`
    // alone is NOT enough; flush the `customFields` key explicitly.
    await onCacheEvent('entity-def.created', { orgId: ORG_ID })
    await getOrgCache().flushKeyForAllOrgs(['customFields', 'entityDefs', 'entityDefSlugs'])
    console.log(`\n  created ${createdFields} field(s); customFields + entityDefs cache flushed`)
  }

  // ── 2. refresh each stream's stored sourceSchema ───────────────────────────
  console.log('\n── 2. stream sourceSchema ──────────────────────────────────')
  const streams = await db.query.DataConnectorStream.findMany({
    where: (s, { eq: e }) => e(s.dataConnectorId, CONNECTOR_ID),
  })
  for (const streamRow of streams) {
    const catStream = catalog.streams.find((s: any) => s.key === streamRow.streamKey)
    if (!catStream) {
      console.log(`  ${streamRow.streamKey}: not in catalog — skipped`)
      continue
    }
    const next = appCatalogStreamSchema(catStream)
    const before = JSON.stringify(streamRow.sourceSchema)
    const after = JSON.stringify(next.sourceSchema)
    console.log(
      `  ${streamRow.streamKey}: ${before === after ? 'unchanged' : `CHANGED (${before.length} → ${after.length} chars)`}`
    )
    if (!APPLY || before === after) continue
    await db
      .update(schema.DataConnectorStream)
      .set({
        sourceSchema: next.sourceSchema,
        schemaSource: next.schemaSource,
        updatedAt: new Date(),
      })
      .where(eq(schema.DataConnectorStream.id, streamRow.id))
  }

  // ── 3. add the missing field mappings ──────────────────────────────────────
  // Reuses the seeder's own partition so a field lands on exactly the mapping it would
  // have at create time, with the same subtree-relative source path.
  console.log('\n── 3. field mappings ───────────────────────────────────────')
  let addedEntries = 0
  for (const streamRow of streams) {
    const catStream = catalog.streams.find((s: any) => s.key === streamRow.streamKey)
    if (!catStream) continue
    const allMappings = catStream.defaultMappings ?? []
    const partition = partitionOwnedFields(catStream.fields, allMappings)
    const allRootPaths = allMappings
      .filter((m: any) => m.target.mode === 'owned')
      .map((m: any) => m.rootPath)

    const rows = await db.query.DataConnectorMapping.findMany({
      where: (m, { eq: e }) => e(m.dataConnectorStreamId, streamRow.id),
    })

    for (const manifest of allMappings) {
      if (manifest.target.mode !== 'owned') continue
      const entries = partition[manifest.rootPath] ?? []
      if (entries.length === 0) continue

      // Rows store the parent-RELATIVE rootPath; the manifest path is absolute.
      const parentRootPath = ownedParentRootPath(manifest.rootPath, allRootPaths)
      const storedRootPath =
        parentRootPath != null
          ? relativeSourcePath(manifest.rootPath, parentRootPath)
          : manifest.rootPath
      const row = rows.find((r) => r.rootPath === storedRootPath && r.targetMode === 'owned')
      if (!row) {
        console.log(`  ${streamRow.streamKey}/${manifest.rootPath}: NO MATCHING ROW — skipped`)
        continue
      }
      if (!row.entityDefinitionId) {
        console.log(
          `  ${streamRow.streamKey}/${manifest.rootPath}: mapping is UNBOUND (entityDefinitionId null) — skipped`
        )
        continue
      }

      const current = (row.fieldMappings ?? []) as any[]
      const haveRefs = new Set(current.map((e) => e.targetFieldRef))
      const ownedApiSlug = (manifest.target as any).entity.apiSlug
      const additions = entries
        .map((e: any) => ({
          id: generateId(),
          targetFieldRef: toAppFieldRef(ownedApiSlug, APP_SLUG, e.field.fieldKey),
          expression: `{${e.relativeSourcePath}}`,
          sourceFields: { [e.relativeSourcePath]: e.relativeSourcePath },
        }))
        .filter((e) => !haveRefs.has(e.targetFieldRef))

      console.log(
        `  ${streamRow.streamKey}/${storedRootPath || '(root)'}: ${current.length} existing, ${additions.length} to add`
      )
      for (const a of additions) console.log(`      + ${a.targetFieldRef}  ← ${a.expression}`)
      if (!APPLY || additions.length === 0) continue

      // `updateMapping` asserts every ref resolves on the def, classifies the edit as
      // `rebackfill` (entries added that write) and stamps `resyncPending` — which is
      // what arms the "Backfill now" banner.
      await updateMapping(db, ORG_ID, row.id, { fieldMappings: [...current, ...additions] as any })
      addedEntries += additions.length
    }
  }
  if (APPLY && addedEntries > 0) console.log(`\n  added ${addedEntries} field mapping entries`)

  const after = await db.query.DataConnector.findFirst({
    where: (c, { eq: e }) => e(c.id, CONNECTOR_ID),
  })
  console.log(`\n  resyncPending: ${JSON.stringify((after as any)?.resyncPending ?? null)}`)

  console.log(
    `\n${APPLY ? 'Applied. Run "Backfill now" (backfillPendingChange) to re-crawl.' : 'Dry run only — nothing written.'}\n`
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
