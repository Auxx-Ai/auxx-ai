// packages/lib/src/data-connectors/catalog-update-queries.ts
// Read side of "Update available" on an app connector
// (plans/money/tasks/41-connector-catalog-update.md section 5.3). Loads the connector,
// its installation, the seeding and current deployments' catalogs, derives both shapes
// with the seeder's own derivation and diffs them against the persisted rows. Nothing
// here writes; `catalog-update.ts` applies what this computes.

import { type Database, schema } from '@auxx/database'
import { getFieldDefinitionId, getFieldId, isResourceFieldId } from '@auxx/types/field'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedCustomFields, getOrgCache } from '../cache'
import { NotFoundError } from '../errors'
import type { ContributingTargetField } from './app-catalog'
import { type CatalogApplyStep, type CatalogDiffEntry, diffConnectorCatalog } from './catalog-diff'
import {
  type DerivedStream,
  deriveConnectorShape,
  hashCatalogConnectorSection,
  type PersistedShapeContext,
  type PersistedStream,
  type ShapeResolver,
  selectCatalogConnector,
  shapeFromPersistedStreams,
} from './catalog-shape'
import { loadShapeResolver } from './mutations'
import { type DataConnectorRow, listStreams } from './service'

/** The deployment on either side of an update, for the button + dialog labels. */
export interface CatalogUpdateDeployment {
  id: string
  /** Production version label; null for a development deployment. */
  version: string | null
  deploymentType: string
  createdAt: Date
}

/** What the connector page reads. */
export interface ConnectorCatalogUpdate {
  /**
   * The seeding and current deployment ids differ AND their connector sections differ
   * (D2). Can be true with zero `entries` (the section changed in a way the rows don't
   * carry); applying then only moves the pointer forward.
   */
  available: boolean
  from: CatalogUpdateDeployment | null
  to: CatalogUpdateDeployment | null
  entries: CatalogDiffEntry[]
}

/** Everything apply needs beyond the public read. */
export interface ConnectorCatalogUpdateContext extends ConnectorCatalogUpdate {
  connector: DataConnectorRow
  /** Null when the app is no longer installed (nothing can be applied). */
  installation: { id: string; currentDeploymentId: string | null } | null
  steps: Map<string, CatalogApplyStep>
  derivedNew: DerivedStream[]
  persisted: PersistedStream[]
}

function projectDeployment(
  row: { id: string; version: string | null; deploymentType: string; createdAt: Date } | null
): CatalogUpdateDeployment | null {
  return row
    ? {
        id: row.id,
        version: row.version,
        deploymentType: row.deploymentType,
        createdAt: row.createdAt,
      }
    : null
}

/**
 * Compute the update for one connector: the public read plus the apply plan. A
 * non-app connector, or one whose app is uninstalled or has no connector section,
 * reports `available: false` rather than failing; only a missing connector is an error.
 */
export async function computeConnectorCatalogUpdate(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<Result<ConnectorCatalogUpdateContext, Error>> {
  const connector = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, connectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  if (!connector) return err(new NotFoundError(`Data connector '${connectorId}' not found`))

  const unavailable = (
    installation: ConnectorCatalogUpdateContext['installation'],
    from: CatalogUpdateDeployment | null = null,
    to: CatalogUpdateDeployment | null = null
  ): Result<ConnectorCatalogUpdateContext, Error> =>
    ok({
      available: false,
      from,
      to,
      entries: [],
      connector,
      installation,
      steps: new Map(),
      derivedNew: [],
      persisted: [],
    })

  if (connector.definitionKind !== 'app' || !connector.appInstallationId) {
    return unavailable(null)
  }
  const installation = await db.query.AppInstallation.findFirst({
    where: eq(schema.AppInstallation.id, connector.appInstallationId),
    columns: { id: true, currentDeploymentId: true, uninstalledAt: true },
  })
  if (!installation || installation.uninstalledAt || !installation.currentDeploymentId) {
    return unavailable(null)
  }
  const installationRef = {
    id: installation.id,
    currentDeploymentId: installation.currentDeploymentId,
  }

  const deploymentIds = [installation.currentDeploymentId]
  if (connector.catalogDeploymentId) deploymentIds.push(connector.catalogDeploymentId)
  const deployments = await db.query.AppDeployment.findMany({
    where: inArray(schema.AppDeployment.id, deploymentIds),
    columns: { id: true, version: true, deploymentType: true, createdAt: true, catalog: true },
  })
  const toDeployment = deployments.find((d) => d.id === installation.currentDeploymentId) ?? null
  const fromDeployment = connector.catalogDeploymentId
    ? (deployments.find((d) => d.id === connector.catalogDeploymentId) ?? null)
    : null
  const to = projectDeployment(toDeployment)
  const from = projectDeployment(fromDeployment)

  const newCatalog = selectCatalogConnector(toDeployment?.catalog)
  if (!toDeployment || !newCatalog) return unavailable(installationRef, from, to)
  const oldCatalog = selectCatalogConnector(fromDeployment?.catalog)

  // D2: same deployment, or a different deployment with an identical connector section,
  // is not an update.
  const available =
    connector.catalogDeploymentId !== installation.currentDeploymentId &&
    (connector.catalogDeploymentId == null ||
      hashCatalogConnectorSection(oldCatalog) !== hashCatalogConnectorSection(newCatalog))
  if (!available) return unavailable(installationRef, from, to)

  const appSlug = connector.type.startsWith('app:')
    ? connector.type.slice('app:'.length)
    : connector.type
  const newEntities = toDeployment.catalog?.entities ?? []
  const oldEntities = fromDeployment?.catalog?.entities ?? []

  const resolver = await loadShapeResolver(db, organizationId, connector.appInstallationId, [
    ...newCatalog.streams,
    ...(oldCatalog?.streams ?? []),
  ])
  const derivedNew = deriveConnectorShape(newCatalog, newEntities, appSlug, resolver)
  const derivedOld = oldCatalog
    ? deriveConnectorShape(oldCatalog, oldEntities, appSlug, resolver)
    : null

  const streams = await listStreams(db, organizationId, connectorId)
  const ctx = await loadPersistedShapeContext(db, organizationId, streams, resolver, [
    ...newEntities,
    ...oldEntities,
  ])
  const persisted = shapeFromPersistedStreams(streams, ctx)

  const { entries, steps } = diffConnectorCatalog(persisted, derivedNew, derivedOld, {
    labelTarget: (target) => labelBindingTarget(target, ctx.fieldsByDefId),
  })

  return ok({
    available,
    from,
    to,
    entries,
    connector,
    installation: installationRef,
    steps,
    derivedNew,
    persisted,
  })
}

/** The public read behind the connector page's Update available button. */
export async function getConnectorCatalogUpdate(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<Result<ConnectorCatalogUpdate, Error>> {
  const result = await computeConnectorCatalogUpdate(db, organizationId, connectorId)
  if (result.isErr()) return err(result.error)
  const { available, from, to, entries } = result.value
  return ok({ available, from, to, entries })
}

/**
 * Org lookups for reading persisted rows back into the comparable shape: the owned
 * defs' `sourceKey`, the manifest apiSlug -> entityKey map, the def -> kind map, and
 * the fields of every def a persisted ref points at (the seeder's resolver only knows
 * the catalog's defs; a hand-retargeted binding may name another).
 */
async function loadPersistedShapeContext(
  db: Database,
  organizationId: string,
  streams: Awaited<ReturnType<typeof listStreams>>,
  resolver: ShapeResolver,
  entities: ReadonlyArray<{ key: string; apiSlug: string }>
): Promise<PersistedShapeContext> {
  const ownedDefIds = new Set<string>()
  const refDefIds = new Set<string>()
  for (const stream of streams) {
    for (const m of stream.mappings) {
      if (m.entityDefinitionId) {
        if (m.targetMode === 'owned') ownedDefIds.add(m.entityDefinitionId)
        refDefIds.add(m.entityDefinitionId)
      }
      for (const fm of m.fieldMappings ?? []) {
        if (fm.targetFieldRef && isResourceFieldId(fm.targetFieldRef)) {
          refDefIds.add(getFieldDefinitionId(fm.targetFieldRef))
        }
      }
    }
  }

  const ownedDefs =
    ownedDefIds.size === 0
      ? []
      : await db.query.EntityDefinition.findMany({
          where: inArray(schema.EntityDefinition.id, [...ownedDefIds]),
          columns: { id: true, sourceKey: true },
        })
  const ownedKeyByDefId = new Map(
    ownedDefs.flatMap((d) => (d.sourceKey ? [[d.id, d.sourceKey] as const] : []))
  )
  const entityKeyByApiSlug = new Map(entities.map((e) => [e.apiSlug, e.key]))
  const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
  const kindByDefId = new Map(Object.entries(entityDefs).map(([kind, defId]) => [defId, kind]))

  const extraFields = new Map<string, ContributingTargetField[]>()
  for (const defId of refDefIds) {
    if (resolver.fieldsByDefId(defId).length > 0) continue
    extraFields.set(defId, await getCachedCustomFields(organizationId, defId))
  }

  return {
    fieldsByDefId: (defId) => {
      const known = resolver.fieldsByDefId(defId)
      return known.length > 0 ? known : (extraFields.get(defId) ?? [])
    },
    ownedEntityKeyByDefId: (defId) => ownedKeyByDefId.get(defId),
    entityKeyByApiSlug: (apiSlug) => entityKeyByApiSlug.get(apiSlug),
    entityKindByDefId: (defId) => kindByDefId.get(defId),
  }
}

/** `part_sku` for a system field, the app field key for an `@app:` ref, else the ref. */
function labelBindingTarget(
  target: string | null,
  fieldsByDefId: ShapeResolver['fieldsByDefId']
): string {
  if (!target) return 'external id'
  if (target.startsWith('@app:')) return target.split(':').slice(2).join(':')
  if (target.startsWith('anchor:')) return 'external id'
  if (!isResourceFieldId(target)) return target
  const field = fieldsByDefId(getFieldDefinitionId(target)).find((f) => f.id === getFieldId(target))
  return field?.systemAttribute ?? field?.name ?? target
}
