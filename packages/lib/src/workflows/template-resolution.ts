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
  /** entityTemplateId → { fieldRef → resolved field key (systemAttribute or name) } */
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

// ── Placeholder rewriting inside variable references ─────────────────

/**
 * A single `@entity:<slug>` or `@field:<ref>` placeholder token.
 * The character class stops at `.`, `[`, `}` and whitespace, so a token only ever
 * consumes one path segment and ordinary prose containing a bare `@` is untouched.
 */
const PLACEHOLDER_TOKEN = /@(entity|field):([A-Za-z0-9_-]+)/g

/** A `{{ … }}` variable span. Mirrors the engine's own pattern (`execution-context.ts`). */
const VARIABLE_SPAN = /\{\{([^}]+)\}\}/g

/** Everything the path rewriter needs to turn a placeholder into a concrete id. */
interface PlaceholderContext {
  /** `@entity:<slug>` → entityTemplateId */
  entityRefToTemplateId: Map<string, string>
  /** entityTemplateId → entityDefinitionId */
  entityIdMap: Record<string, string>
  /** entityTemplateId → { fieldRef → customFieldId } */
  fieldIdMap: Record<string, Record<string, string>>
  /** nodeId → the `@entity:<slug>` that node operates on (captured before rewriting) */
  nodeEntityRefs: Map<string, string>
  /** Called with the owning node id whenever a placeholder can't be resolved. */
  markUnresolved: (nodeId: string) => void
}

/**
 * Resolve `@entity:<slug>` to the value the engine actually keys variables by:
 * the system type string for system entities, the entity-definition id otherwise.
 * Mirrors how `resourceType` is rewritten so both stay in lockstep.
 */
function resolveEntityPlaceholder(
  slug: string,
  ctx: PlaceholderContext
): { templateId: string; value: string } | null {
  const templateId = ctx.entityRefToTemplateId.get(`@entity:${slug}`)
  if (!templateId) return null

  const entityDefId = ctx.entityIdMap[templateId]
  if (!entityDefId) return null

  return {
    templateId,
    // System entities use the type string directly; custom entities use the ID
    value: templateId.startsWith('__system:') ? templateId.replace('__system:', '') : entityDefId,
  }
}

/** The first path segment of a variable reference (`find-1.orders[0].x` → `find-1`). */
function firstPathSegment(path: string): string {
  return path.trim().split(/[.[]/)[0] ?? ''
}

/**
 * Rewrite the placeholders inside one variable path (the text between `{{` and `}}`,
 * or a bare variable reference such as a Tiptap `variable-node` `variableId`).
 *
 * `@field:` resolves against the nearest preceding `@entity:` token in the same path;
 * with no such token it falls back to the entity of the node the path starts at, so
 * both `{{find-1.@entity:orders.@field:orderNumber}}` and
 * `{{find-1.orders[0].@field:orderNumber}}` resolve. Unresolvable tokens are left
 * verbatim and the owning node is reported as unresolved — the same fail-soft
 * behaviour the `resourceType` path already has.
 */
function rewriteVariablePath(path: string, nodeId: string, ctx: PlaceholderContext): string {
  const originRef = ctx.nodeEntityRefs.get(firstPathSegment(path))
  let currentTemplateId = originRef ? ctx.entityRefToTemplateId.get(originRef) : undefined

  return path.replace(PLACEHOLDER_TOKEN, (match, kind: string, ref: string) => {
    if (kind === 'entity') {
      const resolved = resolveEntityPlaceholder(ref, ctx)
      if (!resolved) {
        ctx.markUnresolved(nodeId)
        return match
      }
      currentTemplateId = resolved.templateId
      return resolved.value
    }

    const fieldId = currentTemplateId ? ctx.fieldIdMap[currentTemplateId]?.[ref] : undefined
    if (!fieldId) {
      ctx.markUnresolved(nodeId)
      return match
    }
    return fieldId
  })
}

/**
 * Apply `visit` to every variable path inside a single string, and only there —
 * the text between `{{` and `}}`, or the whole string when it is a bare variable
 * reference starting with a node id in this graph (the same shape
 * `TemplateGraphTransformer.cloneGraph` remaps node ids in, e.g. a Tiptap
 * `variable-node` `attrs.variableId`). Ordinary prose is returned untouched, so an
 * `@` that isn't a placeholder inside a variable reference can never be corrupted.
 */
function mapStringVariablePaths(
  value: string,
  nodeIds: Set<string>,
  visit: (path: string) => string
): string {
  if (!value.includes('@entity:') && !value.includes('@field:')) return value

  if (value.includes('{{')) {
    return value.replace(VARIABLE_SPAN, (_full, inner: string) => `{{${visit(inner)}}}`)
  }

  if (nodeIds.has(firstPathSegment(value))) {
    return visit(value)
  }

  return value
}

/**
 * Walk every value under a node's `data` and run `visit` over the variable paths
 * found in each string, substituting whatever it returns.
 *
 * Object *keys* are deliberately left alone — `data` / `fieldModes` /
 * `fieldUpdateModes*` keys are rewritten by the config pass, and `$comment` is
 * template-authoring prose that must never be touched.
 */
function mapVariablePaths(
  value: unknown,
  nodeIds: Set<string>,
  visit: (path: string) => string
): unknown {
  if (typeof value === 'string') {
    return mapStringVariablePaths(value, nodeIds, visit)
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = mapVariablePaths(value[i], nodeIds, visit)
    }
    return value
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (key === '$comment') continue
      record[key] = mapVariablePaths(record[key], nodeIds, visit)
    }
    return record
  }

  return value
}

/**
 * Resolve `@entity:` and `@field:` references throughout a workflow graph.
 *
 * Two passes, both mutating the graph in place (caller should clone first):
 *
 * 1. **Config pass** — CRUD/Find nodes only: `resourceType`, `data` /
 *    `fieldModes` / `fieldUpdateModes` / `fieldUpdateModeVars` keys, and find-node
 *    `conditionGroups[].conditions[].fieldId` (compound `entityDefId:fieldId`).
 * 2. **Variable pass** — every node: placeholders inside `{{ … }}` spans and bare
 *    variable references anywhere in `node.data`. This is what makes CUID-keyed
 *    engine variables expressible from a template: a find node's `findOne` on a
 *    custom entity publishes under the entity-definition id, so a template writes
 *    `{{find-order.@entity:orders}}` and gets `{{find-order.<entityDefId>}}`.
 *
 * Runs after `TemplateGraphTransformer.cloneGraph`, so the node ids embedded in
 * variable references are already the new ones — placeholder rewriting and node-id
 * remapping touch disjoint parts of the string and compose in either direction.
 */
export function resolveEntityRefsInGraph(
  graph: WorkflowGraph,
  requiredEntities: RequiredEntity[],
  entityIdMap: Record<string, string>,
  fieldIdMap: Record<string, Record<string, string>>
): { graph: WorkflowGraph; unresolvedNodes: string[] } {
  const unresolved = new Set<string>()

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

  // Capture each node's declared entity BEFORE the config pass rewrites resourceType —
  // the variable pass uses it to give a bare `@field:` its entity context.
  const nodeIds = new Set<string>()
  const nodeEntityRefs = new Map<string, string>()
  for (const node of graph.nodes) {
    nodeIds.add(node.id)
    const resourceType = node.data?.resourceType
    if (typeof resourceType === 'string' && resourceType.startsWith('@entity:')) {
      nodeEntityRefs.set(node.id, resourceType)
    }
  }

  for (const node of graph.nodes) {
    if (node.data.type !== 'crud' && node.data.type !== 'find') continue

    const resourceType = node.data.resourceType as string
    if (!resourceType?.startsWith('@entity:')) continue

    const templateId = entityRefToTemplateId.get(resourceType)
    if (!templateId) {
      unresolved.add(node.id)
      continue
    }

    // Resolve entity definition ID
    const entityDefId = entityIdMap[templateId]
    if (!entityDefId) {
      unresolved.add(node.id)
      node.data.resourceType = ''
      continue
    }

    // System entities use the type string directly; custom entities use the ID
    if (templateId.startsWith('__system:')) {
      node.data.resourceType = templateId.replace('__system:', '')
    } else {
      node.data.resourceType = entityDefId
    }

    const fields = fieldIdMap[templateId]
    if (!fields) continue

    // Resolve @field: references in node data keys
    if (node.data.data) {
      const resolvedData: Record<string, any> = {}
      for (const [key, value] of Object.entries(node.data.data as Record<string, any>)) {
        if (key.startsWith('@field:')) {
          const fieldRef = key.replace('@field:', '')
          const fieldId = fields[fieldRef]
          resolvedData[fieldId ?? key] = value
        } else {
          resolvedData[key] = value
        }
      }
      node.data.data = resolvedData
    }

    // Resolve @field: keys in fieldModes to match resolved data keys
    if (node.data.fieldModes) {
      const resolvedFieldModes: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(node.data.fieldModes as Record<string, boolean>)) {
        if (key.startsWith('@field:')) {
          const fieldRef = key.replace('@field:', '')
          const fieldId = fields[fieldRef]
          resolvedFieldModes[fieldId ?? key] = value
        } else {
          resolvedFieldModes[key] = value
        }
      }
      node.data.fieldModes = resolvedFieldModes
    }

    // Resolve @field: keys in fieldUpdateModes (relation/multi-select update mode per field)
    if (node.data.fieldUpdateModes) {
      const resolved: Record<string, string> = {}
      for (const [key, value] of Object.entries(
        node.data.fieldUpdateModes as Record<string, string>
      )) {
        if (key.startsWith('@field:')) {
          const fieldRef = key.replace('@field:', '')
          const fieldId = fields[fieldRef]
          resolved[fieldId ?? key] = value
        } else {
          resolved[key] = value
        }
      }
      node.data.fieldUpdateModes = resolved
    }

    // Resolve @field: keys in fieldUpdateModeVars (dynamic mode variable per field)
    if (node.data.fieldUpdateModeVars) {
      const resolved: Record<string, string> = {}
      for (const [key, value] of Object.entries(
        node.data.fieldUpdateModeVars as Record<string, string>
      )) {
        if (key.startsWith('@field:')) {
          const fieldRef = key.replace('@field:', '')
          const fieldId = fields[fieldRef]
          resolved[fieldId ?? key] = value
        } else {
          resolved[key] = value
        }
      }
      node.data.fieldUpdateModeVars = resolved
    }

    // Resolve @field: references in find node conditionGroups
    // Find node fieldIds use compound format: entityDefinitionId:customFieldId
    if (node.data.type === 'find' && node.data.conditionGroups) {
      for (const group of node.data.conditionGroups as any[]) {
        for (const condition of group.conditions ?? []) {
          if (typeof condition.fieldId === 'string' && condition.fieldId.startsWith('@field:')) {
            const fieldRef = condition.fieldId.replace('@field:', '')
            const fieldId = fields[fieldRef]
            if (fieldId) condition.fieldId = `${entityDefId}:${fieldId}`
          }
        }
      }
    }
  }

  // ── Pass 2: placeholders inside variable references, on every node ──
  const placeholderCtx: PlaceholderContext = {
    entityRefToTemplateId,
    entityIdMap,
    fieldIdMap,
    nodeEntityRefs,
    markUnresolved: (nodeId) => unresolved.add(nodeId),
  }

  for (const node of graph.nodes) {
    if (!node.data || typeof node.data !== 'object') continue
    mapVariablePaths(node.data, nodeIds, (path) =>
      rewriteVariablePath(path, node.id, placeholderCtx)
    )
  }

  return { graph, unresolvedNodes: Array.from(unresolved) }
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

    // Scan all dictionaries that may contain @field: refs
    for (const dict of [
      node.data.data,
      node.data.fieldModes,
      node.data.fieldUpdateModes,
      node.data.fieldUpdateModeVars,
    ]) {
      if (!dict) continue
      for (const key of Object.keys(dict as Record<string, unknown>)) {
        if (key.startsWith('@field:')) {
          fieldRefs.add(key.replace('@field:', ''))
        }
      }
    }

    entityMap.set(slug, fieldRefs)
  }

  // Scan variable references for refs that never appear as a resourceType or a
  // dictionary key — e.g. `{{find-order.@entity:orders.@field:orderNumber}}`.
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const nodeSlugs = new Map<string, string>()
  for (const node of graph.nodes) {
    const resourceType = node.data?.resourceType
    if (typeof resourceType === 'string' && resourceType.startsWith('@entity:')) {
      nodeSlugs.set(node.id, resourceType.replace('@entity:', ''))
    }
  }

  for (const node of graph.nodes) {
    if (!node.data || typeof node.data !== 'object') continue
    mapVariablePaths(node.data, nodeIds, (path) => {
      let currentSlug = nodeSlugs.get(firstPathSegment(path))
      for (const match of path.matchAll(PLACEHOLDER_TOKEN)) {
        const [, kind, ref] = match as unknown as [string, string, string]
        if (kind === 'entity') {
          currentSlug = ref
          if (!entityMap.has(ref)) entityMap.set(ref, new Set())
        } else if (currentSlug) {
          const refs = entityMap.get(currentSlug) ?? new Set<string>()
          refs.add(ref)
          entityMap.set(currentSlug, refs)
        }
      }
      return path
    })
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
