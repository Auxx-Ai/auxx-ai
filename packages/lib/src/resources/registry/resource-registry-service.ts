// packages/lib/src/resources/registry/resource-registry-service.ts

import type { Database } from '@auxx/database'
import {
  FieldType as FieldTypeEnum,
  type ModelType,
  ModelTypeMeta,
  ModelTypeValues,
} from '@auxx/database/enums'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { ENTITY_DEFINITION_TYPES, isEntityDefinitionType } from '@auxx/types/resource'
import { mapFieldTypeToBaseType } from '../../workflow-engine/utils/field-type-mapper'
import { RESOURCE_DISPLAY_CONFIG } from './display-config'
import { resolveEntityDefTypeId } from './entity-def-resolver'
import { getEntityInstanceFields } from './entity-instance-fields'
import { RESOURCE_FIELD_REGISTRY, RESOURCE_TABLE_REGISTRY, type TableId } from './field-registry'
import type { ResourceField } from './field-types'
import type {
  CustomResource,
  CustomResourceId,
  DisplayFieldConfig,
  Resource,
  SystemResource,
} from './types'

/** Keys of metadata fields that should appear after business fields */
const TRAILING_FIELD_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'created_by_id'])

/** Reorder fields so metadata fields (id, createdAt, updatedAt, created_by_id) appear last */
function sortFieldsWithMetadataLast(fields: ResourceField[]): ResourceField[] {
  const leading: ResourceField[] = []
  const trailing: ResourceField[] = []
  for (const field of fields) {
    if (
      TRAILING_FIELD_KEYS.has(field.key) ||
      TRAILING_FIELD_KEYS.has(field.systemAttribute ?? '')
    ) {
      trailing.push(field)
    } else {
      leading.push(field)
    }
  }
  return [...leading, ...trailing]
}

/**
 * Old system types that use modelType string directly as entityDefinitionId.
 * These don't have an EntityDefinition row - the modelType IS the entityDefinitionId.
 */
const OLD_SYSTEM_TYPES = ModelTypeValues.filter(
  (t) => !isEntityDefinitionType(t) && t !== 'entity'
) as readonly ModelType[]

/**
 * ApiSlug to ModelType mapping for old system types.
 * e.g., 'threads' -> 'thread', 'users' -> 'user'
 */
const OLD_SYSTEM_API_SLUG_MAP = Object.fromEntries(
  OLD_SYSTEM_TYPES.map((t) => [ModelTypeMeta[t].apiSlug, t])
) as Record<string, ModelType>

/**
 * ApiSlug to EntityType mapping for entity definition types that have ModelTypeMeta entries.
 * e.g., 'contacts' -> 'contact', 'tickets' -> 'ticket'
 * Note: Some ENTITY_DEFINITION_TYPES (like 'entity_group') don't have ModelTypeMeta entries.
 */
const ENTITY_DEF_API_SLUG_MAP = Object.fromEntries(
  ENTITY_DEFINITION_TYPES.filter((t) => t in ModelTypeMeta).map((t) => [
    ModelTypeMeta[t as keyof typeof ModelTypeMeta].apiSlug,
    t,
  ])
) as Record<string, (typeof ENTITY_DEFINITION_TYPES)[number]>

/** CustomField entity from database */
type CustomFieldRecord = {
  id: string
  name: string
  type: string
  description: string | null
  required: boolean
  options: unknown
  modelType: string
  entityDefinitionId: string | null
  isUnique: boolean
  sortOrder: string | null
  systemAttribute: string | null
  // Capability flags
  isCreatable: boolean
  isUpdatable: boolean
  isComputed: boolean
  isSortable: boolean
  isFilterable: boolean
}

/** EntityDefinition with display field relations and customFields loaded */
type EntityDefinitionWithFields = {
  id: string
  apiSlug: string
  singular: string
  plural: string
  icon: string
  color: string | null
  organizationId: string
  entityType: string | null
  isVisible: boolean
  primaryDisplayField: { id: string; name: string; type: string } | null
  secondaryDisplayField: { id: string; name: string; type: string } | null
  avatarField: { id: string; name: string; type: string } | null
  customFields: CustomFieldRecord[]
}

/**
 * Transform a CustomField to DisplayFieldConfig
 */
function toDisplayFieldConfig(
  field: { id: string; name: string; type: string } | null
): DisplayFieldConfig | null {
  if (!field) return null
  return { id: field.id, name: field.name, type: field.type }
}

/**
 * Transform an EntityDefinition to CustomResource (without fields - added separately)
 * If entityType is defined, it's a system entity stored in EntityDefinition
 * If entityType is null, it's a custom entity
 */
function toCustomResourceBase(
  def: Omit<EntityDefinitionWithFields, 'customFields'>
): Omit<CustomResource, 'fields'> {
  return {
    id: def.id as CustomResourceId,
    apiSlug: def.apiSlug,
    type: 'custom',
    label: def.singular || ModelTypeMeta[def.entityType as ModelType]?.label || def.apiSlug,
    entityType: def.entityType ?? undefined,
    plural: def.plural,
    icon: def.icon,
    color: def.color ?? 'gray',
    entityDefinitionId: def.id,
    organizationId: def.organizationId,
    isVisible: def.isVisible,
    display: {
      primaryDisplayField: toDisplayFieldConfig(def.primaryDisplayField),
      secondaryDisplayField: toDisplayFieldConfig(def.secondaryDisplayField),
      avatarField: toDisplayFieldConfig(def.avatarField),
      defaultSortField: 'updatedAt',
      defaultSortDirection: 'desc',
      orgScopingStrategy: 'direct',
    },
  }
}

/**
 * Build a SystemResource base from registry entry and display config (without fields)
 */
function toSystemResourceBase(tableId: TableId): Omit<SystemResource, 'fields'> {
  const entry = RESOURCE_TABLE_REGISTRY.find((r) => r.id === tableId)
  if (!entry) throw new Error(`Unknown system resource: ${tableId}`)

  const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
  const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]

  // Helper to create DisplayFieldConfig from field ID
  const getDisplayFieldConfig = (fieldId: string | undefined): DisplayFieldConfig | null => {
    if (!fieldId || !fieldRegistry) return null
    const field = fieldRegistry[fieldId]
    if (!field) return null
    return {
      id: field.id,
      name: field.label || field.key,
      type: field.fieldType,
    }
  }

  return {
    id: entry.id,
    entityDefinitionId: entry.id,
    type: 'system',
    entityType: tableId,
    label: entry.label,
    plural: entry.plural,
    icon: entry.icon,
    color: entry.color,
    apiSlug: entry.apiSlug,
    dbName: entry.dbName,
    isVisible: false, // System resources from registry are hidden from sidebar
    display: {
      identifierField: displayConfig.identifierField,
      primaryDisplayField: getDisplayFieldConfig(displayConfig.primaryDisplayFieldId),
      secondaryDisplayField: getDisplayFieldConfig(displayConfig.secondaryDisplayFieldId),
      avatarField: getDisplayFieldConfig(displayConfig.avatarFieldId),
      searchFields: displayConfig.searchFields,
      defaultSortField: displayConfig.defaultSortField,
      defaultSortDirection: displayConfig.defaultSortDirection,
      orgScopingStrategy: displayConfig.orgScopingStrategy ?? 'direct',
      joinScoping: displayConfig.joinScoping,
    },
  }
}

/**
 * Build a SystemResource from registry entry and display config (with static fields only)
 * Used for synchronous access when custom fields are not needed
 */
function toSystemResource(tableId: TableId): SystemResource {
  const systemResourceBase = toSystemResourceBase(tableId)
  const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
  const systemFields: ResourceField[] = fieldRegistry ? Object.values(fieldRegistry) : []

  // Add resourceFieldId to system fields
  const hydratedFields = systemFields.map((field) => ({
    ...field,
    resourceFieldId: toResourceFieldId(systemResourceBase.entityDefinitionId, field.id),
  }))

  return {
    ...systemResourceBase,
    fields: hydratedFields,
  }
}

/**
 * Service to access the unified resource registry.
 * Returns resources (system + custom entities) with display config merged in.
 *
 * Includes internal caching to avoid repeated DB lookups for the same resource type
 * during a single workflow execution.
 */
export class ResourceRegistryService {
  private db: Database
  private organizationId: string

  // Performance optimization: Cache field definitions per resource type
  private fieldCache: Map<string, ResourceField[]> = new Map()

  // Performance optimization: Cache full resource definitions
  private resourceCache: Map<string, Resource> = new Map()

  // Performance optimization: Cache by apiSlug for fast lookup
  private apiSlugCache: Map<string, CustomResource> = new Map()

  constructor(organizationId: string, db: Database) {
    this.organizationId = organizationId
    this.db = db
  }

  /**
   * Clear all internal caches.
   * Call this if you need to refresh data during a long-running operation.
   */
  clearCache(): void {
    this.fieldCache.clear()
    this.resourceCache.clear()
    this.apiSlugCache.clear()
  }

  /**
   * Get all available resources (system + custom) with display config and fields included.
   * Custom fields are fetched separately and merged with both system and custom resources.
   */
  async getAll(): Promise<Resource[]> {
    // Query 1: Entity definitions (without nested customFields)
    const entityDefinitions = await this.db.query.EntityDefinition.findMany({
      where: (defs, { eq, and, isNull }) =>
        and(eq(defs.organizationId, this.organizationId), isNull(defs.archivedAt)),
      with: {
        primaryDisplayField: true,
        secondaryDisplayField: true,
        avatarField: true,
      },
    })

    // Query 2: All active custom fields for organization
    const customFields = await this.db.query.CustomField.findMany({
      where: (fields, { eq, and }) =>
        and(eq(fields.organizationId, this.organizationId), eq(fields.active, true)),
      orderBy: (fields, { asc }) => [asc(fields.sortOrder)],
    })

    // Group fields by target (entityDefinitionId for custom entities, modelType for system models)
    const fieldsByEntityId = new Map<string, CustomFieldRecord[]>()
    const fieldsByModelType = new Map<string, CustomFieldRecord[]>()

    // Static registry IDs — fields for these types always route to fieldsByModelType
    // so the system resource picks them up (e.g., thread's CustomField-backed thread_tags)
    const staticRegistryIds = new Set(RESOURCE_TABLE_REGISTRY.map((r) => r.id))

    for (const field of customFields as CustomFieldRecord[]) {
      if (field.entityDefinitionId && !staticRegistryIds.has(field.modelType)) {
        // Custom entity field — group by entityDefinitionId
        const existing = fieldsByEntityId.get(field.entityDefinitionId) ?? []
        fieldsByEntityId.set(field.entityDefinitionId, [...existing, field])
      } else {
        // System resource field OR no entityDefinitionId — group by modelType
        const existing = fieldsByModelType.get(field.modelType) ?? []
        fieldsByModelType.set(field.modelType, [...existing, field])
      }
    }

    // System resources with merged fields (static registry + organization custom fields)
    // DB CustomField versions take priority; static-only metadata is preserved via enrichment
    const systemResources: SystemResource[] = RESOURCE_TABLE_REGISTRY.map((r) => {
      const tableId = r.id as TableId
      const systemResourceBase = toSystemResourceBase(tableId)
      const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
      const staticFields = fieldRegistry ? Object.values(fieldRegistry) : []
      const orgCustomFields = fieldsByModelType.get(tableId) ?? []

      return {
        ...systemResourceBase,
        fields: sortFieldsWithMetadataLast(
          this.mergeSystemAndCustomFields(
            staticFields,
            orgCustomFields,
            systemResourceBase.entityDefinitionId
          )
        ),
      }
    })

    // Filter out EntityDefinitions that overlap with static registry resources (e.g., thread)
    const filteredEntityDefs = entityDefinitions.filter(
      (def) => !def.entityType || !staticRegistryIds.has(def.entityType)
    )

    // Custom resources with fields from grouped map
    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    const customResources: CustomResource[] = filteredEntityDefs.map((def) => {
      const instanceFields = getEntityInstanceFields()
      const hydratedInstanceFields = this.mapSystemFieldsToResourceFields(instanceFields, def.id)

      return {
        ...toCustomResourceBase(def),
        fields: sortFieldsWithMetadataLast([
          ...hydratedInstanceFields,
          ...this.mapCustomFieldsToResourceFields(fieldsByEntityId.get(def.id) ?? [], def.id),
        ]),
      }
    })

    return [...systemResources, ...customResources]
  }

  /**
   * Get all system resources only (synchronous, no database call)
   * Returns only static fields from the registry.
   * Use getAll() if you need organization's custom fields included.
   */
  getSystemResources(): SystemResource[] {
    return RESOURCE_TABLE_REGISTRY.map((r) => toSystemResource(r.id as TableId))
  }

  /**
   * Get all custom entity resources for this organization (with fields)
   */
  async getCustomResources(): Promise<CustomResource[]> {
    const entityDefinitions = await this.db.query.EntityDefinition.findMany({
      where: (defs, { eq, and, isNull }) =>
        and(eq(defs.organizationId, this.organizationId), isNull(defs.archivedAt)),
      with: {
        primaryDisplayField: true,
        secondaryDisplayField: true,
        avatarField: true,
        customFields: {
          where: (fields, { eq }) => eq(fields.active, true),
          orderBy: (fields, { asc }) => [asc(fields.sortOrder)],
        },
      },
    })

    // Filter out EntityDefinitions that overlap with static registry resources (e.g., thread)
    const staticRegistryIds = new Set(RESOURCE_TABLE_REGISTRY.map((r) => r.id))
    const filteredEntityDefs = (entityDefinitions as EntityDefinitionWithFields[]).filter(
      (def) => !def.entityType || !staticRegistryIds.has(def.entityType)
    )

    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    return filteredEntityDefs.map((def) => {
      const instanceFields = getEntityInstanceFields()
      const hydratedInstanceFields = this.mapSystemFieldsToResourceFields(instanceFields, def.id)

      return {
        ...toCustomResourceBase(def),
        fields: [
          ...hydratedInstanceFields,
          ...this.mapCustomFieldsToResourceFields(def.customFields, def.id),
        ],
      }
    })
  }

  /**
   * Get custom resource by apiSlug (with fields)
   */
  async getBySlug(slug: string): Promise<CustomResource | null> {
    const entityDef = await this.db.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, isNull }) =>
        and(
          eq(defs.apiSlug, slug),
          eq(defs.organizationId, this.organizationId),
          isNull(defs.archivedAt)
        ),
      with: {
        primaryDisplayField: true,
        secondaryDisplayField: true,
        avatarField: true,
        customFields: {
          where: (fields, { eq }) => eq(fields.active, true),
          orderBy: (fields, { asc }) => [asc(fields.sortOrder)],
        },
      },
    })

    if (!entityDef) return null

    // Filter out EntityDefinitions that overlap with static registry resources (e.g., thread)
    const staticRegistryIds = new Set(RESOURCE_TABLE_REGISTRY.map((r) => r.id))
    if (entityDef.entityType && staticRegistryIds.has(entityDef.entityType)) return null

    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    const instanceFields = getEntityInstanceFields()
    const hydratedInstanceFields = this.mapSystemFieldsToResourceFields(
      instanceFields,
      entityDef.id
    )

    return {
      ...toCustomResourceBase(entityDef as EntityDefinitionWithFields),
      fields: [
        ...hydratedInstanceFields,
        ...this.mapCustomFieldsToResourceFields(
          (entityDef as EntityDefinitionWithFields).customFields,
          entityDef.id
        ),
      ],
    }
  }

  /**
   * Get custom resource by raw apiSlug (e.g., "products")
   * Checks apiSlugCache first, then DB lookup via getBySlug.
   * Caches result in both apiSlugCache and resourceCache.
   */
  async getByApiSlug(apiSlug: string): Promise<CustomResource | null> {
    // Check cache first
    const cached = this.apiSlugCache.get(apiSlug)
    if (cached) return cached

    // Use existing getBySlug which queries DB
    const resource = await this.getBySlug(apiSlug)

    if (resource) {
      // Cache by both apiSlug AND canonical resourceId
      this.apiSlugCache.set(apiSlug, resource)
      this.resourceCache.set(resource.id, resource)
    }

    return resource
  }

  /**
   * Get resource by ID with display config and fields included
   * Supports system resource IDs (TableId) and custom entity IDs (UUID/EntityDefinitionId).
   *
   * For system resources: Returns static registry fields + organization's custom fields
   * For custom entities: Returns custom entity with fields from EntityDefinition
   *
   * Results are cached to avoid repeated DB lookups.
   */
  async getById(resourceId: string): Promise<Resource | null> {
    // Check cache first
    if (this.resourceCache.has(resourceId)) {
      return this.resourceCache.get(resourceId)!
    }

    let resource: Resource | null = null

    // Check if system resource
    const systemEntry = RESOURCE_TABLE_REGISTRY.find((r) => r.id === resourceId)
    if (systemEntry) {
      const tableId = systemEntry.id as TableId
      const systemResourceBase = toSystemResourceBase(tableId)

      // Get static fields from registry
      const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
      const staticFields = fieldRegistry ? Object.values(fieldRegistry) : []

      // Get custom fields from database (includes fields with entityDefinitionId, e.g., thread_tags)
      const customFields = await this.db.query.CustomField.findMany({
        where: (f, { eq, and }) =>
          and(
            eq(f.organizationId, this.organizationId),
            eq(f.modelType, tableId),
            eq(f.active, true)
          ),
        orderBy: (f, { asc }) => [asc(f.sortOrder)],
      })

      resource = {
        ...systemResourceBase,
        fields: this.mergeSystemAndCustomFields(
          staticFields,
          customFields as CustomFieldRecord[],
          systemResourceBase.entityDefinitionId
        ),
      }
    } else {
      // Custom entity - treat as EntityDefinitionId (UUID) - no entity_ prefix needed
      const entityDef = await this.db.query.EntityDefinition.findFirst({
        where: (defs, { eq, and, isNull }) =>
          and(
            eq(defs.id, resourceId),
            eq(defs.organizationId, this.organizationId),
            isNull(defs.archivedAt)
          ),
        with: {
          primaryDisplayField: true,
          secondaryDisplayField: true,
          avatarField: true,
          customFields: {
            where: (fields, { eq }) => eq(fields.active, true),
            orderBy: (fields, { asc }) => [asc(fields.sortOrder)],
          },
        },
      })

      if (entityDef) {
        // Include implicit EntityInstance system fields before custom fields
        const instanceFields = getEntityInstanceFields()
        const hydratedInstanceFields = this.mapSystemFieldsToResourceFields(
          instanceFields,
          resourceId
        )

        resource = {
          ...toCustomResourceBase(entityDef as EntityDefinitionWithFields),
          fields: [
            ...hydratedInstanceFields,
            ...this.mapCustomFieldsToResourceFields(
              (entityDef as EntityDefinitionWithFields).customFields,
              resourceId
            ),
          ],
        }
      }
    }

    // Cache the result (even if null, to avoid repeated lookups)
    if (resource) {
      this.resourceCache.set(resourceId, resource)
    }

    return resource
  }

  /**
   * Check if resource ID is a system resource
   */
  isSystemResource(resourceId: string): resourceId is TableId {
    return RESOURCE_TABLE_REGISTRY.some((r) => r.id === resourceId)
  }

  /**
   * Check if resource ID is a custom entity (UUID format, not a system resource)
   */
  isCustomResource(resourceId: string): boolean {
    // Not a system resource and has UUID format (minimum CUID2 length)
    return !this.isSystemResource(resourceId) && resourceId.length >= 20
  }

  /**
   * Get fields for a resource (system or custom)
   * Used by backend services that need fields for a specific resource.
   *
   * For system resources: Returns static registry fields + organization's custom fields
   * For custom resources: Returns custom fields from EntityDefinition
   *
   * Results are cached to avoid repeated DB lookups for the same resource type.
   */
  async getFieldsForResource(resourceId: string): Promise<ResourceField[]> {
    // Check cache first
    if (this.fieldCache.has(resourceId)) {
      return this.fieldCache.get(resourceId)!
    }

    let fields: ResourceField[] = []

    if (this.isSystemResource(resourceId)) {
      // Static fields from registry
      const fieldRegistry = RESOURCE_FIELD_REGISTRY[resourceId]
      const staticFields = fieldRegistry ? Object.values(fieldRegistry) : []

      // Custom fields from database (includes fields with entityDefinitionId, e.g., thread_tags)
      const customFields = await this.db.query.CustomField.findMany({
        where: (f, { eq, and }) =>
          and(
            eq(f.organizationId, this.organizationId),
            eq(f.modelType, resourceId),
            eq(f.active, true)
          ),
        orderBy: (f, { asc }) => [asc(f.sortOrder)],
      })

      fields = this.mergeSystemAndCustomFields(
        staticFields,
        customFields as CustomFieldRecord[],
        resourceId
      )
    } else if (this.isCustomResource(resourceId)) {
      // resourceId is now EntityDefinitionId (UUID) directly
      const entityDef = await this.db.query.EntityDefinition.findFirst({
        where: (defs, { eq, and, isNull }) =>
          and(
            eq(defs.id, resourceId),
            eq(defs.organizationId, this.organizationId),
            isNull(defs.archivedAt)
          ),
        with: {
          customFields: {
            where: (fields, { eq }) => eq(fields.active, true),
            orderBy: (fields, { asc }) => [asc(fields.sortOrder)],
          },
        },
      })

      if (entityDef) {
        // Include implicit EntityInstance system fields before custom fields
        const instanceFields = getEntityInstanceFields()
        const hydratedInstanceFields = this.mapSystemFieldsToResourceFields(
          instanceFields,
          resourceId
        )

        fields = [
          ...hydratedInstanceFields,
          ...this.mapCustomFieldsToResourceFields(
            entityDef.customFields as CustomFieldRecord[],
            resourceId
          ),
        ]
      }
    }

    // Cache the result
    this.fieldCache.set(resourceId, fields)
    return fields
  }

  /**
   * Get all fields that can be used to identify/match existing records.
   * Includes system fields with isIdentifier and custom fields with isUnique.
   */
  getIdentifierFields(resource: Resource): ResourceField[] {
    // All fields marked as identifiers (system identifiers + unique custom fields)
    return resource.fields.filter((f) => f.isIdentifier)
  }

  /**
   * Get the default identifier field for a resource.
   * Returns the first identifier field, or undefined if none.
   */
  getDefaultIdentifierField(resource: Resource): ResourceField | undefined {
    const identifiers = this.getIdentifierFields(resource)
    return identifiers[0]
  }

  /**
   * Resolves an entity type or entity definition ID to the actual entityDefinitionId.
   *
   * Input can be:
   * 1. Old system type (thread, user, inbox, etc.) - returns the type string directly
   * 2. New system type (contact, part, ticket) - queries EntityDefinition, caches result
   * 3. Actual entityDefinitionId (CUID) - returns as-is
   *
   * @param entityTypeOrDefId - An entity type string or entityDefinitionId
   * @returns The resolved entityDefinitionId
   */
  async resolveEntityDefId(entityTypeOrDefId: string): Promise<string> {
    // 1. Check if it's an old system type - return directly
    if (OLD_SYSTEM_TYPES.includes(entityTypeOrDefId as ModelType)) {
      return entityTypeOrDefId
    }

    // 2. Check if it's an entity definition type - query DB with caching
    if (isEntityDefinitionType(entityTypeOrDefId)) {
      return resolveEntityDefTypeId(this.organizationId, entityTypeOrDefId, this.db)
    }

    // 3. Assume it's an actual entityDefinitionId - return as-is
    return entityTypeOrDefId
  }

  /**
   * Resolves an apiSlug to the actual entityDefinitionId.
   *
   * Input can be:
   * 1. Old system apiSlug (threads, users, inboxes, etc.) - returns the modelType string directly
   * 2. New system apiSlug (contacts, parts, tickets) - queries EntityDefinition by entityType, caches result
   * 3. Custom entity apiSlug (products, companies, etc.) - queries EntityDefinition by apiSlug, NO caching
   *
   * @param apiSlug - An apiSlug string (e.g., 'contacts', 'threads', 'products')
   * @returns The resolved entityDefinitionId
   */
  async resolveEntityDefIdFromApiSlug(apiSlug: string): Promise<string> {
    // 1. Check if it's an old system apiSlug - return the modelType directly
    const oldSystemType = OLD_SYSTEM_API_SLUG_MAP[apiSlug]
    if (oldSystemType) {
      return oldSystemType
    }

    // 2. Check if it's an entity definition apiSlug - query DB with caching
    const entityDefType = ENTITY_DEF_API_SLUG_MAP[apiSlug]
    if (entityDefType) {
      return resolveEntityDefTypeId(this.organizationId, entityDefType, this.db)
    }

    // 3. Custom entity apiSlug - query DB without caching (apiSlug can change)
    return this.resolveCustomEntityDefIdBySlug(apiSlug)
  }

  /**
   * Resolves a custom entity apiSlug to its entityDefinitionId.
   * Does NOT cache because apiSlugs can be changed by users.
   */
  private async resolveCustomEntityDefIdBySlug(apiSlug: string): Promise<string> {
    const entityDef = await this.db.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, isNull }) =>
        and(
          eq(defs.organizationId, this.organizationId),
          eq(defs.apiSlug, apiSlug),
          isNull(defs.archivedAt)
        ),
      columns: { id: true },
    })

    if (!entityDef) {
      throw new Error(`EntityDefinition not found for apiSlug: ${apiSlug}`)
    }

    return entityDef.id
  }

  /**
   * Merge static registry fields with DB CustomField records for system resources.
   * DB CustomField versions take priority (they have real UUIDs needed for FieldValue writes).
   * Static-only metadata (dynamicOptionsKey, operatorOverrides, showInPanel, etc.) is preserved
   * by enriching the DB version. Truly custom fields (no static match) are appended.
   *
   * @param staticFields - Fields from field registry (THREAD_FIELDS, etc.)
   * @param customFields - CustomField records from database
   * @param entityDefinitionId - Entity ID to construct resourceFieldId
   * @returns Deduplicated ResourceField[] — no duplicate systemAttribute entries
   */
  private mergeSystemAndCustomFields(
    staticFields: ResourceField[],
    customFields: CustomFieldRecord[],
    entityDefinitionId: string
  ): ResourceField[] {
    // Build systemAttribute -> static field lookup for enrichment
    const staticByAttr = new Map<string, ResourceField>()
    for (const field of staticFields) {
      if (field.systemAttribute) {
        staticByAttr.set(field.systemAttribute, field)
      }
    }

    // Track which systemAttributes are covered by DB fields
    const matchedAttributes = new Set<string>()

    // Map DB fields, enriching with static metadata where available
    const dbFields = this.mapCustomFieldsToResourceFields(customFields, entityDefinitionId)
    const enrichedDbFields = dbFields.map((dbField) => {
      const staticField = dbField.systemAttribute
        ? staticByAttr.get(dbField.systemAttribute)
        : undefined

      if (staticField) {
        matchedAttributes.add(dbField.systemAttribute!)
        // DB field takes priority, enrich with static-only properties
        return {
          ...dbField,
          key: staticField.key,
          dbColumn: staticField.dbColumn,
          dynamicOptionsKey: staticField.dynamicOptionsKey,
          operatorOverrides: staticField.operatorOverrides,
          showInPanel: staticField.showInPanel,
          placeholder: staticField.placeholder,
          nullable: staticField.nullable,
          defaultValue: staticField.defaultValue,
          // Merge relationship config — DB object exists but inverseResourceFieldId may be null
          // when the seeder linker couldn't resolve it. Fall back to static definition.
          relationship:
            dbField.relationship || staticField.relationship
              ? {
                  ...(dbField.relationship ?? staticField.relationship),
                  inverseResourceFieldId:
                    dbField.relationship?.inverseResourceFieldId ??
                    staticField.relationship?.inverseResourceFieldId ??
                    null,
                }
              : undefined,
        }
      }

      return dbField
    })

    // Static fields without a DB counterpart (e.g., 'id' excluded by seeder)
    const unmatchedStaticFields = staticFields
      .filter((f) => !f.systemAttribute || !matchedAttributes.has(f.systemAttribute))
      .map((field) => ({
        ...field,
        resourceFieldId: toResourceFieldId(entityDefinitionId, field.id),
      }))

    return [...unmatchedStaticFields, ...enrichedDbFields]
  }

  /**
   * Map system fields from registry to ResourceField format with resourceFieldId.
   * Similar to mapCustomFieldsToResourceFields but for static system fields.
   *
   * @param systemFields - Fields from field registry (CONTACT_FIELDS, etc.)
   * @param entityDefinitionId - Entity ID to construct resourceFieldId
   * @returns Hydrated ResourceField[] with resourceFieldId included
   */
  private mapSystemFieldsToResourceFields(
    systemFields: ResourceField[],
    entityDefinitionId: string
  ): ResourceField[] {
    return systemFields.map((field) => ({
      ...field,
      resourceFieldId: toResourceFieldId(entityDefinitionId, field.id),
    }))
  }

  /**
   * Map CustomField records to ResourceField format
   * Adds convenience properties and normalizes options for UI consumption
   * @param customFields - Array of CustomField records
   * @param entityDefinitionId - Optional: Entity definition ID to populate resourceFieldId
   */
  private mapCustomFieldsToResourceFields(
    customFields: CustomFieldRecord[],
    entityDefinitionId?: string
  ): ResourceField[] {
    return customFields.map((field) => {
      const fieldId = toFieldId(field.id)

      // Build resourceFieldId if entityDefinitionId is available
      const resourceFieldId = entityDefinitionId
        ? toResourceFieldId(entityDefinitionId, fieldId)
        : undefined
      const baseType = mapFieldTypeToBaseType(field.type)

      // Check if this is a select-type field
      const isSelectType =
        field.type === FieldTypeEnum.SINGLE_SELECT ||
        field.type === FieldTypeEnum.MULTI_SELECT ||
        field.type === FieldTypeEnum.TAGS

      // Extract raw options from field
      const rawOptions = field.options as {
        options?: {
          value: string
          label: string
          color?: string
          targetTimeInStatus?: { value: number; unit: 'days' | 'months' | 'years' }
          celebration?: boolean
        }[]
        relationship?: RelationshipConfig
      }

      // Build relationship config for workflow engine (top-level) and UI (in options)
      // Both use raw RelationshipConfig - consumers derive values using helpers
      let relationship: ResourceField['relationship']

      if (field.type === FieldTypeEnum.RELATIONSHIP) {
        const rel = rawOptions?.relationship

        // Pass through raw RelationshipConfig - no normalization
        if (rel) {
          relationship = {
            inverseResourceFieldId: rel.inverseResourceFieldId,
            relationshipType: rel.relationshipType,
            isInverse: rel.isInverse,
          }
        }
      }

      // Build normalized options for UI (uses value key, includes relationship)
      const normalizedOptions: ResourceField['options'] = {
        // Spread existing flat display options (checkboxStyle, decimals, format, etc.)
        ...(field.options as ResourceField['options']),
        // Select options with 'value' key
        options: isSelectType
          ? rawOptions?.options?.map((o) => ({
              value: o.value,
              label: o.label,
              color: o.color,
              targetTimeInStatus: o.targetTimeInStatus,
              celebration: o.celebration,
            }))
          : undefined,
        // Pass through raw RelationshipConfig - consumers derive values using helpers
        relationship,
      }

      // Determine if this is a system field based on the field's systemAttribute
      // A field is only a system field if it has a systemAttribute set
      // Custom fields added to any entity (system or custom) should never be marked as system
      const isSystemField = !!field.systemAttribute

      // System fields cannot have their definition configured
      // But their values can still be updated (e.g., you can change an email value, but not rename the "Email" field)
      const isConfigurable = !isSystemField

      return {
        // Core identifiers
        id: fieldId,
        resourceFieldId,
        // Use field.id as key — maximally stable (rename-proof, template-resolution compatible)
        // For system resources, mergeSystemAndCustomFields() overrides with the static registry key
        key: field.id,
        label: field.name,
        type: baseType,

        fieldType: field.type as any,
        description: field.description ?? undefined,

        // System field properties - determined by field's systemAttribute
        isSystem: isSystemField,
        showInPanel: true, // All fields shown in panel
        systemAttribute: field.systemAttribute ?? undefined,

        // Convenience properties (avoid needing transforms)
        name: field.name,
        sortOrder: field.sortOrder ?? undefined,
        active: true,
        isUnique: field.isUnique,
        required: field.required,

        // Capabilities - use database values
        capabilities: {
          filterable: field.isFilterable,
          sortable: field.isSortable,
          creatable: field.isCreatable,
          updatable: field.isUpdatable,
          configurable: isConfigurable, // Can edit field definition (name, type, etc.)
          required: field.required,
          computed: field.isComputed,
          unique: field.isUnique,
        },

        // Top-level relationship for workflow engine
        relationship,

        // Normalized options for UI (includes options.options with value key, options.relationship)
        options: normalizedOptions,

        // Import identifier
        isIdentifier: field.isUnique,
      }
    })
  }
}
