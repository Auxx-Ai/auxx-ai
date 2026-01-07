// packages/lib/src/resources/registry/resource-registry-service.ts

import type { Database } from '@auxx/database'
import { RESOURCE_TABLE_REGISTRY, RESOURCE_FIELD_REGISTRY, type TableId } from './field-registry'
import { RESOURCE_DISPLAY_CONFIG } from './display-config'
import type {
  Resource,
  SystemResource,
  CustomResource,
  DisplayFieldConfig,
  CustomResourceId,
} from './types'
import type { ResourceField } from './field-types'
import { mapFieldTypeToBaseType } from '../../workflow-engine/utils/field-type-mapper'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { getEntityInstanceFields } from './entity-instance-fields'

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
 */
function toCustomResourceBase(
  def: Omit<EntityDefinitionWithFields, 'customFields'>
): Omit<CustomResource, 'fields'> {
  return {
    id: def.id as CustomResourceId,
    apiSlug: def.apiSlug,
    type: 'custom',
    label: def.singular,
    plural: def.plural,
    icon: def.icon,
    color: def.color ?? undefined,
    entityDefinitionId: def.id,
    organizationId: def.organizationId,
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

  return {
    id: entry.id,
    type: 'system',
    label: entry.label,
    plural: entry.plural,
    icon: entry.icon,
    dbName: entry.dbName,
    display: {
      identifierField: displayConfig.identifierField,
      displayNameField: displayConfig.displayNameField,
      secondaryInfoField: displayConfig.secondaryInfoField,
      avatarField: displayConfig.avatarField,
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
  const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
  const fields: ResourceField[] = fieldRegistry ? Object.values(fieldRegistry) : []

  return {
    ...toSystemResourceBase(tableId),
    fields,
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

    for (const field of customFields as CustomFieldRecord[]) {
      if (field.entityDefinitionId) {
        const existing = fieldsByEntityId.get(field.entityDefinitionId) ?? []
        fieldsByEntityId.set(field.entityDefinitionId, [...existing, field])
      } else {
        const existing = fieldsByModelType.get(field.modelType) ?? []
        fieldsByModelType.set(field.modelType, [...existing, field])
      }
    }

    // System resources with merged fields (static registry + organization custom fields)
    const systemResources: SystemResource[] = RESOURCE_TABLE_REGISTRY.map((r) => {
      const tableId = r.id as TableId
      const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
      const staticFields = fieldRegistry ? Object.values(fieldRegistry) : []
      const orgCustomFields = fieldsByModelType.get(tableId) ?? []
      const customResourceFields = this.mapCustomFieldsToResourceFields(orgCustomFields)

      return {
        ...toSystemResourceBase(tableId),
        fields: [...staticFields, ...customResourceFields],
      }
    })

    // Custom resources with fields from grouped map
    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    const customResources: CustomResource[] = entityDefinitions.map((def) => ({
      ...toCustomResourceBase(def),
      fields: [
        ...getEntityInstanceFields(),
        ...this.mapCustomFieldsToResourceFields(fieldsByEntityId.get(def.id) ?? []),
      ],
    }))

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

    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    return (entityDefinitions as EntityDefinitionWithFields[]).map((def) => ({
      ...toCustomResourceBase(def),
      fields: [
        ...getEntityInstanceFields(),
        ...this.mapCustomFieldsToResourceFields(def.customFields),
      ],
    }))
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

    // Include implicit EntityInstance system fields (id, createdAt, updatedAt) before custom fields
    return {
      ...toCustomResourceBase(entityDef as EntityDefinitionWithFields),
      fields: [
        ...getEntityInstanceFields(),
        ...this.mapCustomFieldsToResourceFields(
          (entityDef as EntityDefinitionWithFields).customFields
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

      // Get static fields from registry
      const fieldRegistry = RESOURCE_FIELD_REGISTRY[tableId]
      const staticFields = fieldRegistry ? Object.values(fieldRegistry) : []

      // Get custom fields from database
      const customFields = await this.db.query.CustomField.findMany({
        where: (f, { eq, and, isNull }) =>
          and(
            eq(f.organizationId, this.organizationId),
            eq(f.modelType, tableId),
            eq(f.active, true),
            isNull(f.entityDefinitionId)
          ),
        orderBy: (f, { asc }) => [asc(f.sortOrder)],
      })

      const customResourceFields = this.mapCustomFieldsToResourceFields(
        customFields as CustomFieldRecord[]
      )

      resource = {
        ...toSystemResourceBase(tableId),
        fields: [...staticFields, ...customResourceFields],
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
        resource = {
          ...toCustomResourceBase(entityDef as EntityDefinitionWithFields),
          fields: [
            ...getEntityInstanceFields(),
            ...this.mapCustomFieldsToResourceFields(
              (entityDef as EntityDefinitionWithFields).customFields
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
   * Get system resource by TableId (synchronous, no database call)
   * Returns only static fields from the registry.
   * Use getById() if you need organization's custom fields included.
   */
  getSystemById(tableId: TableId): SystemResource {
    return toSystemResource(tableId)
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

      // Custom fields from database (where modelType matches and entityDefinitionId is null)
      const customFields = await this.db.query.CustomField.findMany({
        where: (f, { eq, and, isNull }) =>
          and(
            eq(f.organizationId, this.organizationId),
            eq(f.modelType, resourceId),
            eq(f.active, true),
            isNull(f.entityDefinitionId)
          ),
        orderBy: (f, { asc }) => [asc(f.sortOrder)],
      })

      const customResourceFields = this.mapCustomFieldsToResourceFields(
        customFields as CustomFieldRecord[]
      )

      fields = [...staticFields, ...customResourceFields]
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
        fields = [
          ...getEntityInstanceFields(),
          ...this.mapCustomFieldsToResourceFields(
            entityDef.customFields as CustomFieldRecord[]
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
   * Map CustomField records to ResourceField format
   * Adds convenience properties and normalizes options for UI consumption
   */
  private mapCustomFieldsToResourceFields(customFields: CustomFieldRecord[]): ResourceField[] {
    return customFields.map((field) => {
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
        relationship?: {
          relatedModelType?: string
          relatedEntityDefinitionId?: string
          relationshipType?: 'belongs_to' | 'has_one' | 'has_many'
        }
      }

      // Build relationship config for workflow engine (top-level)
      let relationship: ResourceField['relationship']
      // Build normalized relationship for UI (in options)
      let optionsRelationship:
        | {
            relatedEntityDefinitionId?: string
            relatedModelType?: string
            relationshipType?: 'belongs_to' | 'has_one' | 'has_many'
          }
        | undefined

      if (field.type === FieldTypeEnum.RELATIONSHIP) {
        const rel = rawOptions?.relationship

        let targetTable: string | undefined
        if (rel?.relatedModelType) {
          targetTable = rel.relatedModelType
        } else if (rel?.relatedEntityDefinitionId) {
          targetTable = rel.relatedEntityDefinitionId
        }

        if (targetTable) {
          relationship = {
            targetTable,
            cardinality: rel?.relationshipType === 'has_many' ? 'one-to-many' : 'many-to-one',
            relatedEntityDefinitionId: rel?.relatedEntityDefinitionId,
            relatedModelType: rel?.relatedModelType,
          }
        }

        // Normalized relationship for UI consumers
        optionsRelationship = {
          relatedEntityDefinitionId: rel?.relatedEntityDefinitionId,
          relatedModelType: rel?.relatedModelType,
          relationshipType: rel?.relationshipType,
        }
      }

      // Build enumValues for workflow engine (uses dbValue)
      const enumValues = isSelectType
        ? rawOptions?.options?.map((o) => ({
            dbValue: o.value,
            label: o.label,
            color: o.color,
            targetTimeInStatus: o.targetTimeInStatus,
            celebration: o.celebration,
          }))
        : undefined

      // Build normalized options for UI (uses value key, includes relationship)
      const normalizedOptions: ResourceField['options'] = {
        // Spread existing flat display options (checkboxStyle, decimals, format, etc.)
        ...(field.options as ResourceField['options']),
        // Normalized enum options for UI (uses 'value' key instead of 'dbValue')
        options: isSelectType
          ? rawOptions?.options?.map((o) => ({
              value: o.value,
              label: o.label,
              color: o.color,
              targetTimeInStatus: o.targetTimeInStatus,
              celebration: o.celebration,
            }))
          : undefined,
        // Normalized relationship for UI consumers
        relationship: optionsRelationship,
      }

      return {
        // Core identifiers
        id: field.id,
        key: field.name,
        label: field.name,
        type: baseType,
        fieldType: field.type,
        description: field.description ?? undefined,

        // Convenience properties (avoid needing transforms)
        name: field.name,
        sortOrder: field.sortOrder ?? undefined,
        active: true,
        isUnique: field.isUnique,
        required: field.required,

        // Capabilities
        capabilities: {
          filterable: true,
          sortable: true,
          creatable: true,
          updatable: true,
          required: field.required,
          isUnique: field.isUnique,
        },

        // enumValues for workflow engine (uses dbValue)
        enumValues,

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
