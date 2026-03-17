// packages/lib/src/workflows/template-resolution.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import type { CachedApp } from '../cache/app-cache-keys'
import type { CachedInstalledApp } from '../cache/org-cache-keys'
import { getAppCache, getOrgCache } from '../cache/singletons'
import type { InstallTemplatesResult } from '../entity-templates/template-installer'
import { getTemplateById as getEntityTemplateById } from '../entity-templates/template-registry'
import type { WorkflowGraph } from './template-graph-transformer'

export interface ResolvedApp {
  appId: string
  installed: boolean
  installationId?: string
  cachedApp: CachedApp
}

/**
 * Resolve an app slug to its ID and installation status for an org.
 * Uses appSlugMap (app-wide) + installedApps (org-scoped) caches.
 * Zero DB queries.
 */
export async function resolveAppSlugForOrg(
  organizationId: string,
  appSlug: string
): Promise<ResolvedApp | null> {
  const appSlugMap = await getAppCache().get('appSlugMap')
  const cachedApp = appSlugMap[appSlug]
  if (!cachedApp) return null

  const installedApps = await getOrgCache().get(organizationId, 'installedApps')
  const installation = installedApps.find((i) => i.app.id === cachedApp.id)

  return {
    appId: cachedApp.id,
    installed: !!installation,
    installationId: installation?.installationId,
    cachedApp,
  }
}

/**
 * Resolve all required app slugs for a template at once.
 * Single cache fetch per cache key (not per slug).
 */
export async function resolveAllAppSlugs(
  organizationId: string,
  appSlugs: string[]
): Promise<Map<string, ResolvedApp>> {
  const appSlugMap = await getAppCache().get('appSlugMap')
  const installedApps = await getOrgCache().get(organizationId, 'installedApps')

  // Index installations by appId for O(1) lookup
  const installByAppId = new Map<string, CachedInstalledApp>()
  for (const inst of installedApps) {
    installByAppId.set(inst.app.id, inst)
  }

  const results = new Map<string, ResolvedApp>()
  for (const slug of appSlugs) {
    const cachedApp = appSlugMap[slug]
    if (!cachedApp) continue

    const installation = installByAppId.get(cachedApp.id)
    results.set(slug, {
      appId: cachedApp.id,
      installed: !!installation,
      installationId: installation?.installationId,
      cachedApp,
    })
  }

  return results
}

// ── Entity Resolution ────────────────────────────────────────────────

/** Portable entity requirement stored on a workflow template */
export interface RequiredEntity {
  /** Built-in entity template ID (e.g., "company") or "__system:contact" for system entities */
  entityTemplateId: string
  /** Maps @field:X refs in CRUD nodes → templateFieldId (or systemAttribute for system entities) */
  fieldMapping: Record<string, string>
  /** templateFieldIds that MUST exist for the workflow to function */
  requiredFields: string[]
  /** Companion entity template IDs to suggest alongside */
  companionTemplateIds?: string[]
  /** If false, workflow can function without this entity (degraded mode) */
  required: boolean
  // ── Display info (stored on template, used client-side) ──
  /** Display name (e.g., "Order", "Company"). For system entities: "Contact", "Ticket" */
  name: string
  /** Entity apiSlug for client-side existence check (e.g., "orders", "companies") */
  apiSlug: string
  /** Entity icon ID from template registry (e.g., "shopping-cart") */
  icon?: string
  /** Entity icon color from template registry (e.g., "green", "blue") */
  color?: string
}

/** Result of checking entity readiness for a workflow template */
export interface EntityResolutionResult {
  /** entityTemplateId → resolved entityDefinitionId */
  entityIdMap: Record<string, string>
  /** entityTemplateId → { fieldRef → resolved customFieldId } */
  fieldIdMap: Record<string, Record<string, string>>
  /** Entities that exist but are missing required fields */
  missingFields: Array<{
    entityTemplateId: string
    entityDefId: string
    missingFieldNames: string[]
  }>
  /** Entity template IDs that don't exist and need installation */
  missingEntities: string[]
  /** Whether all required entities are fully resolved */
  allResolved: boolean
}

/**
 * Check entity readiness for a workflow template.
 * Uses org caches only — zero DB queries.
 */
export async function checkEntityReadiness(
  organizationId: string,
  requiredEntities: RequiredEntity[]
): Promise<EntityResolutionResult> {
  if (requiredEntities.length === 0) {
    return {
      entityIdMap: {},
      fieldIdMap: {},
      missingFields: [],
      missingEntities: [],
      allResolved: true,
    }
  }

  const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
  const entityDefSlugs = await getOrgCache().get(organizationId, 'entityDefSlugs')
  const customFields = await getOrgCache().get(organizationId, 'customFields')

  const entityIdMap: Record<string, string> = {}
  const fieldIdMap: Record<string, Record<string, string>> = {}
  const missingFields: EntityResolutionResult['missingFields'] = []
  const missingEntities: string[] = []

  for (const req of requiredEntities) {
    // ── System entity shortcut ──
    if (req.entityTemplateId.startsWith('__system:')) {
      const systemType = req.entityTemplateId.replace('__system:', '')
      const entityDefId = entityDefs[systemType] ?? systemType
      entityIdMap[req.entityTemplateId] = entityDefId

      // Resolve fields by systemAttribute
      const fields: CustomFieldEntity[] = customFields[entityDefId] ?? []
      const resolved: Record<string, string> = {}
      for (const [fieldRef, systemAttr] of Object.entries(req.fieldMapping)) {
        const field = fields.find((f) => f.systemAttribute === systemAttr)
        if (field) resolved[fieldRef] = field.id
      }
      fieldIdMap[req.entityTemplateId] = resolved
      continue
    }

    // ── Custom entity: check if it exists ──
    const template = getEntityTemplateById(req.entityTemplateId)
    if (!template) continue

    const apiSlug = template.entity.apiSlug
    const entityDefId = entityDefSlugs[apiSlug]

    if (!entityDefId) {
      missingEntities.push(req.entityTemplateId)
      continue
    }

    entityIdMap[req.entityTemplateId] = entityDefId

    // ── Resolve fields from cache ──
    const fields: CustomFieldEntity[] = customFields[entityDefId] ?? []
    const resolved: Record<string, string> = {}
    const missing: string[] = []

    for (const [fieldRef, templateFieldId] of Object.entries(req.fieldMapping)) {
      const templateField = template.fields.find((f) => f.templateFieldId === templateFieldId)
      if (!templateField) continue

      // Match by name (most common) → systemAttribute → templateFieldId fallback
      const field = fields.find(
        (f) => f.name === templateField.name || f.systemAttribute === templateFieldId
      )

      if (field) {
        resolved[fieldRef] = field.id
      } else if (req.requiredFields.includes(templateFieldId)) {
        missing.push(templateField.name)
      }
    }

    fieldIdMap[req.entityTemplateId] = resolved

    if (missing.length > 0) {
      missingFields.push({
        entityTemplateId: req.entityTemplateId,
        entityDefId,
        missingFieldNames: missing,
      })
    }
  }

  const allResolved = missingEntities.length === 0 && missingFields.length === 0

  return { entityIdMap, fieldIdMap, missingFields, missingEntities, allResolved }
}

/**
 * Resolve field references from an entity template installer result.
 * Called after the user installs missing entities via EntityTemplateDialog.
 */
export function resolveFieldsFromInstallerResult(
  requiredEntities: RequiredEntity[],
  installerResult: InstallTemplatesResult
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}

  for (const req of requiredEntities) {
    if (req.entityTemplateId.startsWith('__system:')) continue

    const resolved: Record<string, string> = {}
    for (const [fieldRef, templateFieldId] of Object.entries(req.fieldMapping)) {
      const key = `${req.entityTemplateId}:${templateFieldId}`
      const fieldId = installerResult.fieldIdMap[key]
      if (fieldId) resolved[fieldRef] = fieldId
    }
    result[req.entityTemplateId] = resolved
  }

  return result
}

/**
 * Resolve @entity: and @field: references in CRUD/Find nodes.
 * MUTATES the graph in place (caller should clone first).
 */
export function resolveEntityRefsInGraph(
  graph: WorkflowGraph,
  requiredEntities: RequiredEntity[],
  entityIdMap: Record<string, string>,
  fieldIdMap: Record<string, Record<string, string>>
): { graph: WorkflowGraph; unresolvedNodes: string[] } {
  const unresolvedNodes: string[] = []

  // Build @entity:slug → entityTemplateId lookup
  const entityRefToTemplateId = new Map<string, string>()
  for (const req of requiredEntities) {
    if (req.entityTemplateId.startsWith('__system:')) {
      const systemType = req.entityTemplateId.replace('__system:', '')
      entityRefToTemplateId.set(`@entity:${systemType}`, req.entityTemplateId)
    } else {
      const template = getEntityTemplateById(req.entityTemplateId)
      if (template) {
        entityRefToTemplateId.set(`@entity:${template.entity.apiSlug}`, req.entityTemplateId)
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.data.type !== 'crud' && node.data.type !== 'find') continue

    const resourceType = node.data.resourceType as string
    if (!resourceType?.startsWith('@entity:')) continue

    const templateId = entityRefToTemplateId.get(resourceType)
    if (!templateId) {
      unresolvedNodes.push(node.id)
      continue
    }

    // Resolve entity definition ID
    const entityDefId = entityIdMap[templateId]
    if (!entityDefId) {
      unresolvedNodes.push(node.id)
      node.data.resourceType = ''
      continue
    }

    // System entities use the type string directly; custom entities use the ID
    if (templateId.startsWith('__system:')) {
      node.data.resourceType = templateId.replace('__system:', '')
    } else {
      node.data.resourceType = entityDefId
    }

    // Resolve @field: references in node data
    if (node.data.data) {
      const fields = fieldIdMap[templateId]
      if (!fields) continue

      const resolvedData: Record<string, any> = {}
      for (const [key, value] of Object.entries(node.data.data as Record<string, any>)) {
        if (key.startsWith('@field:')) {
          const fieldRef = key.replace('@field:', '')
          const fieldId = fields[fieldRef]
          if (fieldId) {
            resolvedData[fieldId] = value
          } else {
            resolvedData[key] = value // Leave unresolved — user can fix manually
          }
        } else {
          resolvedData[key] = value
        }
      }
      node.data.data = resolvedData
    }
  }

  return { graph, unresolvedNodes }
}

/**
 * Extract required entities from a workflow graph by scanning for @entity: and @field: refs.
 * Used by the admin authoring UI to auto-generate a starter requiredEntities config.
 */
export function extractRequiredEntities(graph: WorkflowGraph): Partial<RequiredEntity>[] {
  const entityMap = new Map<string, Set<string>>()

  for (const node of graph.nodes) {
    if (node.data.type !== 'crud' && node.data.type !== 'find') continue

    const resourceType = node.data.resourceType as string
    if (!resourceType?.startsWith('@entity:')) continue

    const slug = resourceType.replace('@entity:', '')
    const fieldRefs = entityMap.get(slug) ?? new Set()

    if (node.data.data) {
      for (const key of Object.keys(node.data.data as Record<string, any>)) {
        if (key.startsWith('@field:')) {
          fieldRefs.add(key.replace('@field:', ''))
        }
      }
    }

    entityMap.set(slug, fieldRefs)
  }

  return Array.from(entityMap.entries()).map(([slug, fieldRefs]) => {
    const isSystem = slug.startsWith('__system:')
    const systemType = isSystem ? slug.replace('__system:', '') : undefined
    const template = isSystem ? undefined : getEntityTemplateById(slug)

    return {
      entityTemplateId: isSystem ? slug : '',
      name: isSystem
        ? systemType!.charAt(0).toUpperCase() + systemType!.slice(1)
        : (template?.name ?? slug),
      apiSlug: isSystem ? systemType! : (template?.entity.apiSlug ?? slug),
      icon: template?.entity.icon,
      color: template?.entity.color,
      fieldMapping: Object.fromEntries(Array.from(fieldRefs).map((ref) => [ref, ref])),
      requiredFields: Array.from(fieldRefs),
      required: true,
    }
  })
}
