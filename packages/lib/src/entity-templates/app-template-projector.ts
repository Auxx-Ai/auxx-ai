// packages/lib/src/entity-templates/app-template-projector.ts
// Project an app's declared entities (`defineEntity`, `catalog.entities`) into
// installable `EntityTemplate`s (app-fields-and-entities-plan, Phase 2 §4.1). One
// `CatalogEntity` becomes one `EntityTemplate`: the def carries the stable
// `sourceKey` (the entity's own `key`) and each field carries
// `appFieldKey === templateFieldId === key` so `installTemplates` stamps both the
// def-level and field-level identity. RELATIONSHIP fields carry symbolic
// `@template:`/`@system:` refs resolved from the field's own `relationship.target`
// so the installer's Pass 4 forms the edges. This supersedes the old
// stream-derivation projector (which read `ConnectorStreamDecl.fields` +
// `defaultMappings` and partitioned owned columns by rootPath) — the catalog now
// carries the entity's field list directly, so there is nothing left to derive.

import type { CatalogEntity, CatalogField } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { RelationshipType, SelectOption } from '@auxx/types/custom-field'
import type { EntityTemplate, EntityTemplateField } from './types'

/** Registry id for an app-projected entity template: `app:<appSlug>:<entityKey>`. */
export function appTemplateId(appSlug: string, entityKey: string): string {
  return `app:${appSlug}:${entityKey}`
}

/**
 * Resolve a RELATIONSHIP field's symbolic target ref from its declared
 * `relationship.target` — `{ entityKey }` names a sibling entity of the SAME app
 * (`@template:app:<slug>:<key>`), `{ entityKind }` names a platform kind
 * (`@system:<kind>`).
 */
function resolveRelationshipTargetRef(
  appSlug: string,
  target: NonNullable<CatalogField['relationship']>['target']
): string {
  if ('entityKey' in target) return `@template:${appTemplateId(appSlug, target.entityKey)}`
  return `@system:${target.entityKind}`
}

/**
 * Map one catalog field (scalar or relationship) onto a template field, stamping
 * `appFieldKey === templateFieldId === key`. Capabilities default to
 * `creatable: false, updatable: false` — an app-owned column is written by the
 * app/connector, not the user, unless the author opted a field into `updatable`.
 */
function projectField(appSlug: string, field: CatalogField): EntityTemplateField {
  const projected: EntityTemplateField = {
    templateFieldId: field.key,
    appFieldKey: field.key,
    name: field.name,
    description: field.description,
    type: field.type as FieldType,
    isCreatable: field.capabilities?.creatable ?? false,
    isUpdatable: field.capabilities?.updatable ?? false,
    isHidden: field.capabilities?.hidden ?? false,
    required: field.capabilities?.required ?? false,
    isUnique: field.capabilities?.unique ?? false,
    isIdentity: field.identity ?? false,
  }
  if (field.options?.length) {
    projected.options = field.options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
      color: o.color as SelectOption['color'],
    }))
  }
  if (field.addressComponents?.length) projected.addressComponents = field.addressComponents
  if (field.type === 'RELATIONSHIP' && field.relationship) {
    projected.relationship = {
      relatedResourceId: resolveRelationshipTargetRef(appSlug, field.relationship.target),
      relationshipType: field.relationship.cardinality as RelationshipType,
      inverseName: field.relationship.inverseName ?? field.name,
    }
  }
  return projected
}

/**
 * Project one app-declared entity into an installable `EntityTemplate`. A direct
 * `CatalogEntity -> EntityTemplate` mapping — no stream derivation, no
 * owned-vs-reference dedupe: the entity's own field list IS the def's field list.
 */
export function projectAppEntityTemplate(appSlug: string, entity: CatalogEntity): EntityTemplate {
  const templateId = appTemplateId(appSlug, entity.key)
  return {
    id: templateId,
    name: entity.singular,
    description: entity.description ?? `${entity.plural}, owned by this app.`,
    categories: ['app'],
    entity: {
      apiSlug: entity.apiSlug,
      singular: entity.singular,
      plural: entity.plural,
      icon: entity.icon ?? 'box',
      color: entity.color ?? 'blue',
      // The stable owner-scoped identity — strict adopt/dedupe key once owner-stamped.
      sourceKey: entity.key,
    },
    primaryDisplayField: entity.primaryDisplayField,
    secondaryDisplayField: entity.secondaryDisplayField,
    avatarField: entity.avatarField,
    fields: entity.fields.map((field) => projectField(appSlug, field)),
  }
}

/**
 * Project every entity an app declares (`catalog.entities`) into installable
 * templates, cross-linking `companions` so the install-consent dialog previews +
 * installs the whole graph at once — mirroring how a static gallery template
 * lists its companions.
 */
export function projectAppEntityTemplates(
  appSlug: string,
  entities: CatalogEntity[]
): EntityTemplate[] {
  const templates = entities.map((entity) => projectAppEntityTemplate(appSlug, entity))
  const allIds = templates.map((t) => t.id)
  for (const template of templates) {
    template.companions = allIds.filter((id) => id !== template.id)
  }
  return templates
}
