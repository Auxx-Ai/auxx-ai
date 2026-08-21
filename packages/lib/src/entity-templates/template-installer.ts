// packages/lib/src/entity-templates/template-installer.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache/invalidate'
import { createCustomField } from '../custom-fields'
import { checkSlugExists, createEntityDefinition } from '../entity-definitions'
import { getTemplatesByIds } from './template-registry'
import type { EntityTemplate, EntityTemplateField } from './types'
import { isSymbolicRef, parseSymbolicRef } from './types'

const logger = createScopedLogger('entity-templates')

/** Options controlling how templates are resolved + installed. */
export interface InstallTemplatesOptions {
  fieldModifications?: Record<string, Record<string, { customName?: string; removed?: boolean }>>
  linkedEntities?: Record<
    string,
    { entityDefinitionId: string; newRelationshipFieldTemplateIds?: string[] }
  >
  /**
   * Org-aware resolver merging the static gallery with templates projected from the
   * org's installed apps. Defaults to the static registry — pass `resolveOrgTemplatesByIds`
   * (bound to the org) to install `app:*` record-type templates.
   */
  resolveTemplates?: (ids: string[]) => Promise<EntityTemplate[]>
  /**
   * Connector/app ownership stamped on the created defs + fields (v6). When the install
   * runs inside a connector wizard, these mark the defs as connector-owned (drives the
   * connector-delete prompt) and app-owned (uninstall cleanup + appFieldKey idempotency).
   * Absent for a plain gallery install.
   */
  installContext?: {
    dataConnectorId?: string
    appInstallationId?: string
  }
}

/** Result of installing templates */
export interface InstallTemplatesResult {
  created: Array<{
    templateId: string
    entityDefinitionId: string
    name: string
    apiSlug: string
  }>
  linked: Array<{
    templateId: string
    entityDefinitionId: string
    name: string
  }>
  skippedRelationships: string[]
  /** Maps "templateId:templateFieldId" → created customFieldId. Serialized as Record for tRPC. */
  fieldIdMap: Record<string, string>
}

/**
 * Install entity definition templates for an organization.
 *
 * Multi-pass approach:
 *   Pass 1: Resolve @system:* refs → look up real entityDefinitionIds
 *   Pass 2: Create entity definitions (handle slug conflicts)
 *   Pass 3: Create non-relationship fields
 *   Pass 4: Create relationship fields (resolve symbolic refs)
 *   Pass 5: Set display fields
 */
export async function installTemplates(
  organizationId: string,
  templateIds: string[],
  options: InstallTemplatesOptions = {}
): Promise<InstallTemplatesResult> {
  const { fieldModifications, linkedEntities, resolveTemplates, installContext } = options

  // Merge templateIds with linked entity template IDs so all templates are resolved
  const allTemplateIds = [...new Set([...templateIds, ...Object.keys(linkedEntities ?? {})])]
  // Resolve org-aware (static gallery + app-projected) when a resolver is provided,
  // else fall back to the static registry.
  const resolve = resolveTemplates ?? (async (ids: string[]) => getTemplatesByIds(ids))
  const templates = await resolve(allTemplateIds)
  if (templates.length === 0) {
    throw new Error('No valid templates found for the provided IDs')
  }

  const skippedRelationships: string[] = []

  // ── Pass 1: Resolve @system:* references ──────────────────────────
  const systemEntityMap = new Map<string, string>()

  // Find all unique system refs needed
  const systemRefsNeeded = new Set<string>()
  for (const template of templates) {
    for (const field of template.fields) {
      if (
        field.relationship?.relatedResourceId &&
        isSymbolicRef(field.relationship.relatedResourceId)
      ) {
        const ref = parseSymbolicRef(field.relationship.relatedResourceId)
        if (ref.type === 'system') {
          systemRefsNeeded.add(ref.target)
        }
      }
    }
  }

  // Look up system entity definition IDs
  if (systemRefsNeeded.size > 0) {
    const systemEntityDefs = await database.query.EntityDefinition.findMany({
      where: eq(schema.EntityDefinition.organizationId, organizationId),
    })

    for (const refTarget of systemRefsNeeded) {
      const def = systemEntityDefs.find((d) => d.entityType === refTarget)
      if (def) {
        systemEntityMap.set(refTarget, def.id)
      } else {
        // System entity not found — will skip relationship fields referencing it
        logger.warn(
          'installTemplates: system entity type not found — relationship fields referencing it will be skipped',
          {
            refTarget,
            organizationId,
          }
        )
      }
    }
  }

  // Build set of template IDs being installed (for @template:* resolution)
  const installingTemplateIds = new Set(templates.map((t) => t.id))

  // ── Pass 2: Create entity definitions ─────────────────────────────
  // Maps templateId → created entityDefinitionId
  const entityIdMap = new Map<string, string>()

  const created: InstallTemplatesResult['created'] = []
  const linked: InstallTemplatesResult['linked'] = []

  for (const template of templates) {
    // If this template is linked to an existing entity, skip creation
    const linkConfig = linkedEntities?.[template.id]
    if (linkConfig) {
      entityIdMap.set(template.id, linkConfig.entityDefinitionId)
      linked.push({
        templateId: template.id,
        entityDefinitionId: linkConfig.entityDefinitionId,
        name: template.name,
      })
      continue
    }

    // Handle slug conflicts by appending a number
    let apiSlug = template.entity.apiSlug
    let slugAttempt = 0
    let slugTaken = true

    while (slugTaken) {
      const candidateSlug = slugAttempt === 0 ? apiSlug : `${apiSlug}-${slugAttempt + 1}`
      const slugCheck = await checkSlugExists({
        slug: candidateSlug,
        organizationId,
      })

      if (slugCheck.isErr()) {
        // Reserved slug — try incrementing
        slugAttempt++
        if (slugAttempt > 10) {
          throw new Error(`Cannot find available slug for template "${template.id}"`)
        }
        continue
      }

      if (!slugCheck.value) {
        apiSlug = candidateSlug
        slugTaken = false
      } else {
        slugAttempt++
        if (slugAttempt > 10) {
          throw new Error(`Cannot find available slug for template "${template.id}"`)
        }
      }
    }

    const result = await createEntityDefinition({
      organizationId,
      apiSlug,
      icon: template.entity.icon,
      color: template.entity.color,
      singular: template.entity.singular,
      plural: template.entity.plural,
      // Always stamp the stable identity: the app/connector manifest key when owned,
      // else the templateId (ownerless provenance). Owner FKs are stamped only inside a
      // connector wizard (installContext) so owned defs are one-per-owner per sourceKey.
      sourceKey: template.entity.sourceKey ?? template.id,
      appInstallationId: installContext?.appInstallationId,
      dataConnectorId: installContext?.dataConnectorId,
    })

    if (result.isErr()) {
      throw new Error(`Failed to create entity "${template.name}": ${result.error.message}`)
    }

    const entityDef = result.value
    entityIdMap.set(template.id, entityDef.id)

    created.push({
      templateId: template.id,
      entityDefinitionId: entityDef.id,
      name: template.name,
      apiSlug,
    })
  }

  // ── Pass 3: Create non-relationship fields ────────────────────────
  // Maps "templateId:templateFieldId" → created customFieldId
  const fieldIdMap = new Map<string, string>()

  for (const template of templates) {
    // Skip all non-relationship field creation for linked entities
    if (linkedEntities?.[template.id]) continue

    const entityDefinitionId = entityIdMap.get(template.id)!
    const nonRelFields = template.fields.filter((f) => f.type !== 'RELATIONSHIP')

    for (const field of nonRelFields) {
      const mod = fieldModifications?.[template.id]?.[field.templateFieldId]
      if (mod?.removed) continue

      const fieldToCreate = mod?.customName ? { ...field, name: mod.customName } : field
      const result = await createField(
        fieldToCreate,
        organizationId,
        entityDefinitionId,
        installContext
      )

      if (result.ok) {
        fieldIdMap.set(`${template.id}:${field.templateFieldId}`, result.fieldId)
      } else {
        // Ships to the log store — a swallowed create here surfaces later as a
        // missing column / unresolved `@app:` ref, which is undiagnosable without it.
        logger.warn('installTemplates: failed to create template field', {
          fieldName: field.name,
          templateId: template.id,
          organizationId,
          error: result.error,
        })
      }
    }
  }

  // ── Pass 4: Create relationship fields ────────────────────────────
  for (const template of templates) {
    const entityDefinitionId = entityIdMap.get(template.id)!
    const linkConfig = linkedEntities?.[template.id]
    const relFields = template.fields.filter((f) => f.type === 'RELATIONSHIP')

    for (const field of relFields) {
      // For linked entities, only create fields explicitly listed in newRelationshipFieldTemplateIds
      if (linkConfig) {
        if (!linkConfig.newRelationshipFieldTemplateIds?.includes(field.templateFieldId)) continue
      }

      const mod = fieldModifications?.[template.id]?.[field.templateFieldId]
      if (mod?.removed) continue

      if (!field.relationship?.relatedResourceId) {
        skippedRelationships.push(`${template.name}.${field.name}: missing relatedResourceId`)
        continue
      }

      const ref = field.relationship.relatedResourceId

      // Resolve symbolic ref to real entity definition ID
      let resolvedResourceId: string | undefined

      if (isSymbolicRef(ref)) {
        const parsed = parseSymbolicRef(ref)

        if (parsed.type === 'system') {
          resolvedResourceId = systemEntityMap.get(parsed.target)
          if (!resolvedResourceId) {
            skippedRelationships.push(
              `${template.name}.${field.name}: system entity "${parsed.target}" not found`
            )
            continue
          }
        } else if (parsed.type === 'template') {
          if (!installingTemplateIds.has(parsed.target)) {
            skippedRelationships.push(
              `${template.name}.${field.name}: companion template "${parsed.target}" not installed`
            )
            continue
          }
          resolvedResourceId = entityIdMap.get(parsed.target)
          if (!resolvedResourceId) {
            skippedRelationships.push(
              `${template.name}.${field.name}: template "${parsed.target}" entity not created`
            )
            continue
          }
        }
      } else {
        resolvedResourceId = ref
      }

      if (!resolvedResourceId) {
        skippedRelationships.push(`${template.name}.${field.name}: could not resolve reference`)
        continue
      }

      const fieldToCreate = mod?.customName ? { ...field, name: mod.customName } : field
      const result = await createField(
        {
          ...fieldToCreate,
          relationship: {
            ...field.relationship,
            relatedResourceId: resolvedResourceId,
          },
        },
        organizationId,
        entityDefinitionId,
        installContext
      )

      if (result.ok) {
        fieldIdMap.set(`${template.id}:${field.templateFieldId}`, result.fieldId)
      } else {
        skippedRelationships.push(`${template.name}.${field.name}: ${result.error}`)
      }
    }
  }

  // ── Pass 5: Set display fields ────────────────────────────────────
  for (const template of templates) {
    // Skip display field updates for linked entities
    if (linkedEntities?.[template.id]) continue

    const entityDefinitionId = entityIdMap.get(template.id)!

    const primaryMod = fieldModifications?.[template.id]?.[template.primaryDisplayField]
    const primaryFieldId = primaryMod?.removed
      ? undefined
      : fieldIdMap.get(`${template.id}:${template.primaryDisplayField}`)

    const secondaryMod = template.secondaryDisplayField
      ? fieldModifications?.[template.id]?.[template.secondaryDisplayField]
      : undefined
    const secondaryFieldId =
      template.secondaryDisplayField && !secondaryMod?.removed
        ? fieldIdMap.get(`${template.id}:${template.secondaryDisplayField}`)
        : undefined

    const avatarMod = template.avatarField
      ? fieldModifications?.[template.id]?.[template.avatarField]
      : undefined
    const avatarFieldId =
      template.avatarField && !avatarMod?.removed
        ? fieldIdMap.get(`${template.id}:${template.avatarField}`)
        : undefined

    if (primaryFieldId || secondaryFieldId || avatarFieldId) {
      await database
        .update(schema.EntityDefinition)
        .set({
          ...(primaryFieldId && { primaryDisplayFieldId: primaryFieldId }),
          ...(secondaryFieldId && { secondaryDisplayFieldId: secondaryFieldId }),
          ...(avatarFieldId && { avatarFieldId }),
          updatedAt: new Date(),
        })
        .where(eq(schema.EntityDefinition.id, entityDefinitionId))
    }
  }

  await onCacheEvent('entity-def.created', { orgId: organizationId })
  return { created, linked, skippedRelationships, fieldIdMap: Object.fromEntries(fieldIdMap) }
}

/** Helper: Create a single field from template field definition */
async function createField(
  field: EntityTemplateField,
  organizationId: string,
  entityDefinitionId: string,
  installContext?: InstallTemplatesOptions['installContext']
): Promise<{ ok: true; fieldId: string } | { ok: false; error: string }> {
  const { templateFieldId, ...fieldInput } = field

  const result = await createCustomField({
    // `...fieldInput` already carries the projected app-template field's `appFieldKey`;
    // the install context stamps the owner FKs so the field is connector-/app-owned and
    // idempotent per `(owner, appFieldKey)` on re-install.
    ...fieldInput,
    organizationId,
    entityDefinitionId,
    isCustom: true,
    appInstallationId: installContext?.appInstallationId ?? fieldInput.appInstallationId,
    dataConnectorId: installContext?.dataConnectorId ?? fieldInput.dataConnectorId,
    // Store templateFieldId as systemAttribute so template resolution can match
    // fields reliably even if the user renames them later
    systemAttribute: templateFieldId,
  })

  if (result.isOk()) {
    return { ok: true, fieldId: result.value.id }
  }

  return {
    ok: false,
    error: 'message' in result.error ? result.error.message : String(result.error),
  }
}
