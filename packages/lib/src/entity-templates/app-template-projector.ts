// packages/lib/src/entity-templates/app-template-projector.ts
// Project an installed app's data-connector manifest into installable entity
// templates (v6 — install-target-defs-via-templates). Each OWNED default-mapping
// becomes one `EntityTemplate` whose def carries the stable `sourceKey` (the manifest
// `key`) and whose fields carry `appFieldKey` so `installTemplates` stamps both the
// def-level and field-level identity. Cross-stream/parent relationships are emitted as
// `@template:`/`@system:` RELATIONSHIP fields so the installer's Pass 4 forms the edges
// (replacing the old `materializeConnectorTargets` relationship pass).

import type { CatalogDataConnector } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { SelectOption } from '@auxx/types/custom-field'
import { ownedParentRootPath, partitionOwnedFields } from '../data-connectors/mutations'
import type { EntityTemplate, EntityTemplateField } from './types'

type CatalogStream = CatalogDataConnector['streams'][number]
type CatalogField = CatalogStream['fields'][number]
type CatalogMapping = NonNullable<CatalogStream['defaultMappings']>[number]

/** Registry id for an app-projected owned-def template: `app:<appSlug>:<ownedKey>`. */
export function appTemplateId(appSlug: string, ownedKey: string): string {
  return `app:${appSlug}:${ownedKey}`
}

/** Map a catalog scalar field onto a template field, stamping `appFieldKey == templateFieldId`. */
function projectScalarField(field: CatalogField): EntityTemplateField {
  const projected: EntityTemplateField = {
    templateFieldId: field.fieldKey,
    appFieldKey: field.fieldKey,
    name: field.name,
    type: field.type as FieldType,
    // App-owned record-type columns are connector-managed (synced, user-read-only) —
    // exactly the owned-field semantics the v5 provisioner stamped.
    isUpdatable: false,
    isCreatable: false,
    isHidden: field.capabilities?.hidden ?? false,
  }
  if (field.options?.length) {
    projected.options = field.options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
      color: o.color as SelectOption['color'],
    }))
  }
  if (field.addressComponents?.length) projected.addressComponents = field.addressComponents
  return projected
}

/**
 * Resolve a relationship edge's symbolic target ref. A `targetRef` names a sibling
 * owned def (`ownedKey` → `@template:app:<slug>:<key>`) or a system/contributing def
 * (`entityKind` → `@system:<kind>`); absent ⇒ the edge points to the child mapping's
 * OWN target (its owned def, or its contributing `entityKind`).
 */
function resolveRelTargetRef(
  appSlug: string,
  rel: NonNullable<CatalogMapping['relationship']>,
  child: CatalogMapping
): string {
  const ref = rel.targetRef
  if (ref && 'ownedKey' in ref) return `@template:${appTemplateId(appSlug, ref.ownedKey)}`
  if (ref && 'entityKind' in ref) return `@system:${ref.entityKind}`
  if (child.target.mode === 'owned') {
    return `@template:${appTemplateId(appSlug, child.target.entity.key)}`
  }
  return `@system:${child.target.entityKind}`
}

/**
 * Project all OWNED record types an app's connector declares into installable
 * `EntityTemplate`s — one per unique owned `key`, deduped across streams. Each template:
 *   - `entity.sourceKey = key` (the stable owner-scoped identity stamp);
 *   - scalar fields = the def's partitioned owned columns (`appFieldKey == fieldKey`);
 *   - relationship fields = the edges declared by child mappings parented on this def.
 * Owner (`appInstallationId`) is stamped at install via the install context, NOT baked
 * into the template — keeping the projection org-agnostic.
 */
export function projectAppConnectorTemplates(
  appSlug: string,
  appTitle: string,
  connector: CatalogDataConnector
): EntityTemplate[] {
  // Collect each unique owned def (by key) with the stream + rootPath that declares it.
  const ownedByKey = new Map<
    string,
    {
      entity: Extract<CatalogMapping['target'], { mode: 'owned' }>['entity']
      stream: CatalogStream
      rootPath: string
    }
  >()
  for (const stream of connector.streams) {
    for (const m of stream.defaultMappings ?? []) {
      if (m.target.mode !== 'owned') continue
      if (!ownedByKey.has(m.target.entity.key)) {
        ownedByKey.set(m.target.entity.key, {
          entity: m.target.entity,
          stream,
          rootPath: m.rootPath,
        })
      }
    }
  }

  const templates: EntityTemplate[] = []
  for (const [key, { entity, stream, rootPath }] of ownedByKey) {
    const mappings = stream.defaultMappings ?? []
    const partition = partitionOwnedFields(stream.fields, mappings)
    const ownedFields = partition[rootPath] ?? []
    const ownedRootPaths = mappings.filter((m) => m.target.mode === 'owned').map((m) => m.rootPath)

    const fields: EntityTemplateField[] = ownedFields.map(({ field }) => projectScalarField(field))

    // Relationship edges live on the PARENT def — a child mapping parented here that
    // declares a `relationship` becomes a RELATIONSHIP field on THIS def.
    for (const child of mappings) {
      if (!child.relationship) continue
      if (ownedParentRootPath(child.rootPath, ownedRootPaths) !== rootPath) continue
      fields.push({
        templateFieldId: child.relationship.fieldKey,
        appFieldKey: child.relationship.fieldKey,
        name: child.relationship.name,
        type: 'RELATIONSHIP' as FieldType,
        isUpdatable: false,
        isCreatable: false,
        relationship: {
          relatedResourceId: resolveRelTargetRef(appSlug, child.relationship, child),
          relationshipType: child.relationship.cardinality,
          inverseName: child.relationship.inverseName,
        },
      })
    }

    const primaryDisplayField =
      entity.primaryDisplayField ??
      ownedFields[0]?.field.fieldKey ??
      fields[0]?.templateFieldId ??
      ''

    templates.push({
      id: appTemplateId(appSlug, key),
      name: entity.singular,
      description: `${entity.plural} synced from the ${appTitle} app.`,
      categories: ['app'],
      entity: {
        apiSlug: entity.apiSlug,
        singular: entity.singular,
        plural: entity.plural,
        icon: connector.iconKey ?? 'box',
        color: 'blue',
        // The stable owner-scoped identity — strict adopt/dedupe key once owner-stamped.
        sourceKey: key,
      },
      primaryDisplayField,
      avatarField: entity.avatarField,
      fields,
    })
  }
  return templates
}
