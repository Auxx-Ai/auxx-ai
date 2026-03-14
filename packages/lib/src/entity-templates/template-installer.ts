// packages/lib/src/entity-templates/template-installer.ts

import { database, schema } from '@auxx/database'
import { createCustomField } from '@auxx/services/custom-fields'
import { checkSlugExists, createEntityDefinition } from '@auxx/services/entity-definitions'
import { eq } from 'drizzle-orm'
import { getTemplatesByIds } from './template-registry'
import type { EntityTemplateField } from './types'
import { isSymbolicRef, parseSymbolicRef } from './types'

/** Result of installing templates */
export interface InstallTemplatesResult {
  created: Array<{
    templateId: string
    entityDefinitionId: string
    name: string
    apiSlug: string
  }>
  skippedRelationships: string[]
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
  templateIds: string[]
): Promise<InstallTemplatesResult> {
  const templates = getTemplatesByIds(templateIds)
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
        console.warn(`System entity type "${refTarget}" not found for org ${organizationId}`)
      }
    }
  }

  // Build set of template IDs being installed (for @template:* resolution)
  const installingTemplateIds = new Set(templates.map((t) => t.id))

  // ── Pass 2: Create entity definitions ─────────────────────────────
  // Maps templateId → created entityDefinitionId
  const entityIdMap = new Map<string, string>()

  const created: InstallTemplatesResult['created'] = []

  for (const template of templates) {
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
    const entityDefinitionId = entityIdMap.get(template.id)!
    const nonRelFields = template.fields.filter((f) => f.type !== 'RELATIONSHIP')

    for (const field of nonRelFields) {
      const result = await createField(field, organizationId, entityDefinitionId)

      if (result.ok) {
        fieldIdMap.set(`${template.id}:${field.templateFieldId}`, result.fieldId)
      } else {
        console.warn(
          `Failed to create field "${field.name}" on template "${template.id}": ${result.error}`
        )
      }
    }
  }

  // ── Pass 4: Create relationship fields ────────────────────────────
  for (const template of templates) {
    const entityDefinitionId = entityIdMap.get(template.id)!
    const relFields = template.fields.filter((f) => f.type === 'RELATIONSHIP')

    for (const field of relFields) {
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

      const result = await createField(
        {
          ...field,
          relationship: {
            ...field.relationship,
            relatedResourceId: resolvedResourceId,
          },
        },
        organizationId,
        entityDefinitionId
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
    const entityDefinitionId = entityIdMap.get(template.id)!

    const primaryFieldId = fieldIdMap.get(`${template.id}:${template.primaryDisplayField}`)
    const secondaryFieldId = template.secondaryDisplayField
      ? fieldIdMap.get(`${template.id}:${template.secondaryDisplayField}`)
      : undefined

    if (primaryFieldId || secondaryFieldId) {
      await database
        .update(schema.EntityDefinition)
        .set({
          ...(primaryFieldId && { primaryDisplayFieldId: primaryFieldId }),
          ...(secondaryFieldId && { secondaryDisplayFieldId: secondaryFieldId }),
          updatedAt: new Date(),
        })
        .where(eq(schema.EntityDefinition.id, entityDefinitionId))
    }
  }

  return { created, skippedRelationships }
}

/** Helper: Create a single field from template field definition */
async function createField(
  field: EntityTemplateField,
  organizationId: string,
  entityDefinitionId: string
): Promise<{ ok: true; fieldId: string } | { ok: false; error: string }> {
  const { templateFieldId, ...fieldInput } = field

  const result = await createCustomField({
    ...fieldInput,
    organizationId,
    entityDefinitionId,
    isCustom: true,
  })

  if (result.isOk()) {
    return { ok: true, fieldId: result.value.id }
  }

  return {
    ok: false,
    error: 'message' in result.error ? result.error.message : String(result.error),
  }
}
