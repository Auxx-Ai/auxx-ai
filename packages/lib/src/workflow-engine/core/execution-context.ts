// packages/lib/src/workflow-engine/core/execution-context.ts

import { type Database, database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import type { ActorId } from '@auxx/types/actor'
import {
  type FieldReference,
  fieldRefToKey,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { LRUCache } from 'lru-cache'
import { getCachedResourceFields } from '../../cache'
import type { FieldOptions } from '../../custom-fields/field-options'
import {
  createFieldValueContext,
  type FieldValueContext,
} from '../../field-values/field-value-helpers'
import { batchGetValues } from '../../field-values/field-value-queries'
import { formatToDisplayValue, formatToRawValue } from '../../field-values/formatter'
import {
  analyzePathForRelationships,
  fetchResourceWithRelationships,
} from '../../resources/resource-fetcher'
import type { FileContextService } from '../services/file-context-service'
import type { FileContentOptions, FileReference } from '../types/file-reference'
import {
  createFileVariable,
  createMultipleFilesVariable,
  type WorkflowFileData,
} from '../types/file-variable'
import {
  isResourceReference,
  type LazyLoadCacheEntry,
  type PathAnalysis,
  type ResourceReference,
} from '../types/resource-reference'
import { safeJsonParse, safeJsonStringify } from '../utils/serialization'
import { batchedJoinUpdater } from './batched-join-updater'
import { joinStateCache } from './join-state-cache'
import type {
  BranchResult,
  ExecutionContext,
  ExecutionLog,
  JoinPointInfo,
  ProcessedMessage,
  WorkflowExecutionOptions,
  WorkflowTriggerEvent,
} from './types'
import { JoinState } from './types'

const logger = createScopedLogger('execution-context')

/** Configuration for the lazy load cache */
const LAZY_LOAD_CACHE_CONFIG = {
  /** Maximum number of cached resources */
  max: 100,
  /** Time-to-live in milliseconds (5 minutes) */
  ttl: 1000 * 60 * 5,
}

// =============================================================================
// RECORD FIELD CACHE TYPES
// =============================================================================

/** Cached field value with metadata for formatting */
interface CachedFieldValue {
  typed: TypedFieldValue | TypedFieldValue[] | null
  fieldType: FieldType
  fieldOptions?: FieldOptions
}

/** Cache entry for a single record (entity instance) */
interface RecordFieldEntry {
  base: {
    id: string
    entityDefinitionId: string
    createdAt?: Date
    updatedAt?: Date
  }
  fields: Map<string, CachedFieldValue> // fieldRefKey -> cached value
  allFieldsFetched: boolean
}

/**
 * Manages workflow execution context including variables, state, and logging
 */
export class ExecutionContextManager {
  private context: ExecutionContext
  private userEmail?: string
  private userName?: string
  private organizationName?: string
  private organizationHandle?: string
  private options?: WorkflowExecutionOptions

  // Lazy loading infrastructure with LRU eviction to prevent memory leaks
  private lazyLoadCache: LRUCache<string, LazyLoadCacheEntry> = new LRUCache({
    max: LAZY_LOAD_CACHE_CONFIG.max,
    ttl: LAZY_LOAD_CACHE_CONFIG.ttl,
  })
  private loadingStack: Set<string> = new Set() // Circular reference detection

  // Note: ResourceRegistryService removed — using org cache via getCachedResourceFields()

  // Performance optimization: Cache path analysis results
  // Key: `${resourceType}:${remainingPath}` → relationshipsNeeded[]
  private pathAnalysisCache: Map<string, string[]> = new Map()

  // Record field cache: stores TypedFieldValues per record, keyed by RecordId
  // Unified cache for field value access — replaces per-field lazy loading for custom entities
  private recordFieldCache: Map<string, RecordFieldEntry> = new Map()

  constructor(
    workflowId: string,
    executionId: string,
    organizationId: string,
    userId?: string,
    userEmail?: string,
    userName?: string,
    organizationName?: string,
    organizationHandle?: string,
    db?: Database
  ) {
    this.context = {
      workflowId,
      executionId,
      organizationId,
      userId,
      variables: {},
      db,
      startedAt: new Date(),
      visitedNodes: new Set(),
      logs: [],
      isBranchContext: false, // V5: Default to false, set to true for branches
    }
    this.userEmail = userEmail
    this.userName = userName
    this.organizationName = organizationName
    this.organizationHandle = organizationHandle
  }

  /**
   * Set execution options
   */
  setOptions(options: WorkflowExecutionOptions): void {
    this.options = options
  }

  /**
   * Get execution options
   */
  getOptions(): WorkflowExecutionOptions | undefined {
    return this.options
  }

  /**
   * Initialize context with trigger data
   */
  initializeWithTrigger(event: WorkflowTriggerEvent): void {
    this.context.triggerData = event.data

    // Expose trigger data as sys.triggerData variable for node processors
    if (event.data) {
      this.setVariable('sys.triggerData', event.data)
    }

    if (event.data?.message) {
      this.context.message = event.data.message as ProcessedMessage
    }

    this.log('INFO', undefined, 'Workflow execution initialized', {
      triggerType: event.type,
      timestamp: event.timestamp,
    })
  }

  /**
   * Set a variable in the context
   */
  setVariable(key: string, value: any): void {
    this.context.variables[key] = value
    // this.log('DEBUG', undefined, `Variable set: ${key}`, { value })
  }

  /**
   * Set a node-specific variable with proper path formatting
   * @param nodeId The ID of the node
   * @param path The variable path (e.g., 'output', 'method', 'headers.content-type')
   * @param value The value to set
   */
  setNodeVariable(nodeId: string, path: string, value: any): void {
    const key = `${nodeId}.${path}`
    this.setVariable(key, value)
  }

  /**
   * Get a variable from the context
   * Now supports nested path resolution for accessing nested properties
   * NOW ASYNC for lazy loading support
   */
  async getVariable(key: string): Promise<any> {
    // Try direct lookup first
    if (this.context.variables[key] !== undefined) {
      return this.context.variables[key]
    }

    // Debug logging for relationship resolution
    this.log('DEBUG', undefined, `getVariable: resolving path`, { key })

    // Fall back to path resolution for nested access
    const result = await this.resolveVariablePath(key)

    this.log('DEBUG', undefined, `getVariable: resolved`, {
      key,
      resultType:
        result === undefined ? 'undefined' : Array.isArray(result) ? 'array' : typeof result,
      isArray: Array.isArray(result),
      arrayLength: Array.isArray(result) ? result.length : undefined,
    })

    return result
  }

  /**
   * Get a node-specific variable
   * NOW ASYNC for lazy loading support
   * @param nodeId The ID of the node
   * @param path The variable path (e.g., 'output', 'method', 'headers.content-type')
   * @returns The variable value or undefined if not found
   */
  async getNodeVariable(nodeId: string, path: string): Promise<any> {
    const fullPath = `${nodeId}.${path}`
    return this.resolveVariablePath(fullPath)
  }

  /**
   * Resolve a variable path with support for nested access and arrays
   * NOW ASYNC to support lazy loading of resource relationships
   *
   * Examples:
   *   "webhook-123.body" → { contact: { email: "test@example.com" } }
   *   "webhook-123.body.contact.email" → "test@example.com"
   *   "webhook-123.items[0]" → First array item
   *   "webhook-123.items[*]" → All array items
   *   "webhook-123.items[*].name" → Array of names
   *   "env.API_KEY" → Environment variable value
   *   "sys.userId" → System variable value
   *   "crud1.ticket.contact.firstName" → Lazy loads contact relationship
   */
  async resolveVariablePath(path: string): Promise<any> {
    // Step 1: Analyze path to find resource references (async for custom entity support)
    const analysis = await this.analyzePath(path)

    if (analysis.baseResourceRef) {
      // Found a resource reference - need to lazy load
      const resource = await this.lazyLoadResourceWithPath(
        analysis.baseResourceRef,
        analysis.baseResourcePath,
        analysis.relationshipsNeeded
      )

      if (!resource) {
        return undefined
      }

      // Navigate remaining path on loaded resource
      if (analysis.remainingPath) {
        const result = this.resolveNestedObject(resource, analysis.remainingPath)

        this.log('DEBUG', undefined, `resolveVariablePath: nested resolution`, {
          remainingPath: analysis.remainingPath,
          resultType:
            result === undefined ? 'undefined' : Array.isArray(result) ? 'array' : typeof result,
          isArray: Array.isArray(result),
          arrayLength: Array.isArray(result) ? result.length : undefined,
        })

        return result
      }

      return resource
    }

    // No resource reference - use existing synchronous logic

    // Handle array syntax
    const arrayMatch = path.match(/^(.+?)\[(\d+|\*)\](.*)$/)
    if (arrayMatch) {
      const basePath = arrayMatch[1]
      const index = arrayMatch[2]
      const rest = arrayMatch[3]

      if (!basePath || !index) return undefined

      const baseValue = await this.resolveVariablePath(basePath)

      if (!Array.isArray(baseValue)) {
        this.log('WARN', undefined, `Attempted to access array index on non-array: ${basePath}`)
        return undefined
      }

      if (index === '*') {
        // Map over array
        if (rest) {
          const restPath = rest.startsWith('.') ? rest.slice(1) : rest
          // Check if items are ResourceReferences — resolve via recordFieldCache
          return Promise.all(
            baseValue.map((item) =>
              isResourceReference(item) && restPath
                ? this.resolveFieldFromResourceRef(item, restPath)
                : this.resolveNestedObject(item, restPath)
            )
          )
        }
        return baseValue
      } else {
        // Access specific index
        const idx = parseInt(index, 10)
        if (idx < 0 || idx >= baseValue.length) {
          this.log('WARN', undefined, `Array index out of bounds: ${path}`)
          return undefined
        }
        const item = baseValue[idx]
        if (rest) {
          const restPath = rest.startsWith('.') ? rest.slice(1) : rest
          // Check if item is a ResourceReference — resolve via recordFieldCache
          if (isResourceReference(item) && restPath) {
            return this.resolveFieldFromResourceRef(item, restPath)
          }
          return this.resolveNestedObject(item, restPath)
        }
        return item
      }
    }

    // Try direct lookup first (fastest path for top-level variables)
    if (this.context.variables[path] !== undefined) {
      return this.context.variables[path]
    }

    // Try to find a stored variable that is a prefix of this path
    // Example: If we have "webhook-123.body" stored, and we're looking up "webhook-123.body.contact.email"
    const segments = path.split('.')

    // Try increasingly shorter prefixes from longest to shortest
    for (let i = segments.length - 1; i > 0; i--) {
      const basePath = segments.slice(0, i).join('.')
      const remainingPath = segments.slice(i).join('.')

      if (this.context.variables[basePath] !== undefined) {
        const baseValue = this.context.variables[basePath]
        // Check if base value is a ResourceReference — resolve field via recordFieldCache
        if (isResourceReference(baseValue) && remainingPath) {
          return this.resolveFieldFromResourceRef(baseValue, remainingPath)
        }
        return this.resolveNestedObject(baseValue, remainingPath)
      }
    }

    this.log('DEBUG', undefined, `Variable not found: ${path}`)
    return undefined
  }

  /**
   * Resolve a nested path within an object
   * Supports array navigation with .first, .last, numeric index, and [n] syntax
   *
   * Examples:
   *   resolveNestedObject({ contact: { email: "..." } }, "contact.email") → "..."
   *   resolveNestedObject({ items: [1, 2, 3] }, "items.first") → 1
   *   resolveNestedObject({ items: [1, 2, 3] }, "items.last") → 3
   *   resolveNestedObject({ items: [1, 2, 3] }, "items.1") → 2
   *   resolveNestedObject({ Variants: [{Price: 10}] }, "Variants.first.Price") → 10
   *
   * For custom entities, also checks fieldValues if segment not found at root
   */
  private resolveNestedObject(obj: any, path: string): any {
    if (!path) return obj
    if (obj === null || obj === undefined) return undefined

    const segments = path.split('.')
    let current = obj

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined
      }

      // Handle .first accessor for arrays
      if (segment === 'first' && Array.isArray(current)) {
        current = current[0]
        continue
      }

      // Handle .last accessor for arrays
      if (segment === 'last' && Array.isArray(current)) {
        current = current[current.length - 1]
        continue
      }

      // Handle numeric index (e.g., "0", "1", "2")
      if (/^\d+$/.test(segment) && Array.isArray(current)) {
        const idx = parseInt(segment, 10)
        current = current[idx]
        continue
      }

      // Handle [n] array access within nested path (e.g., "items[0]" or "items[*]")
      const arrayMatch = segment.match(/^(.+?)\[(\d+|\*)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]
        const index = arrayMatch[2]

        if (!key || !index) return undefined

        current = current[key]

        if (!Array.isArray(current)) {
          return undefined
        }

        if (index === '*') {
          return current // Return the array itself
        } else {
          const idx = parseInt(index, 10)
          current = current[idx]
        }
      } else {
        if (typeof current !== 'object') {
          return undefined
        }

        // Try direct property access first
        if (current[segment] !== undefined) {
          current = current[segment]
        }
        // For entity instances, check fieldValues if not found at root
        else if (current.fieldValues && current.fieldValues[segment] !== undefined) {
          current = current.fieldValues[segment]
        } else {
          current = undefined
        }
      }
    }

    return current
  }

  /**
   * Interpolate variables in a string
   * NOW ASYNC to support lazy loading
   * Example: "Hello {{webhook-123.body.name}}" → "Hello John"
   */
  async interpolateVariables(text: string): Promise<string> {
    if (!text || typeof text !== 'string') return text

    const varPattern = /\{\{([^}]+)\}\}/g
    const matches = Array.from(text.matchAll(varPattern))

    if (matches.length === 0) {
      return text
    }

    let result = text

    // Process each match
    for (const match of matches) {
      const path = match[1]?.trim()
      if (!path) continue

      const value = await this.resolveVariablePath(path)

      if (value === undefined || value === null) {
        this.log('WARN', undefined, `Variable not found during interpolation: ${path}`)
        continue // Keep original {{...}} if not found
      }

      // Convert value to string, escaping $ characters to prevent special replacement patterns
      // String.replace() treats $& $' $` $n specially in replacement strings
      let replacement: string
      if (typeof value === 'object') {
        replacement = this.toDisplayString(value, path)
      } else {
        replacement = String(value)
      }

      // Escape $ characters: $$ is the escape sequence for a literal $
      const safeReplacement = replacement.replace(/\$/g, '$$$$')

      result = result.replace(match[0], safeReplacement)
    }

    return result
  }

  /**
   * Convert an object value to a display string for interpolation.
   * Checks the recordFieldCache for display values when the path resolved through a ResourceReference.
   * Falls back to heuristics (name/label properties) or JSON.stringify for non-entity objects.
   */
  private toDisplayString(value: unknown, variablePath: string): string {
    if (value == null) return ''
    if (typeof value !== 'object') return String(value)

    // For arrays, join elements
    if (Array.isArray(value)) {
      return value.map((v) => this.toDisplayString(v, '')).join(', ')
    }

    // Try common display-friendly properties
    const obj = value as Record<string, unknown>
    if ('name' in obj && typeof obj.name === 'string') return obj.name
    if ('label' in obj && typeof obj.label === 'string') return obj.label
    if ('displayName' in obj && typeof obj.displayName === 'string') return obj.displayName
    if ('value' in obj && typeof obj.value === 'string') return obj.value

    return JSON.stringify(value)
  }

  /**
   * Analyze a variable path to find resource references and determine
   * which relationships need lazy loading.
   *
   * FIXED: Now also checks lazyLoadCache for previously loaded resources.
   * When a ResourceReference is first accessed, it gets replaced with loaded data.
   * Subsequent accesses to different fields on the same resource failed because
   * isResourceReference() returned false. By checking the cache, we can still
   * identify resources that need additional relationships loaded.
   *
   * @param path - Full variable path (e.g., "crud1.ticket.contact.firstName")
   * @returns Analysis with base resource and relationships needed
   */
  private async analyzePath(path: string): Promise<PathAnalysis> {
    const segments = path.split('.')

    // Try to find the longest matching base path that's a resource reference
    // Start from full path and work backwards
    for (let i = segments.length; i > 0; i--) {
      const basePath = segments.slice(0, i).join('.')
      const value = this.context.variables[basePath]

      // Check if this is a ResourceReference (original, not yet loaded)
      if (isResourceReference(value)) {
        const remainingPath = segments.slice(i).join('.')

        this.log('DEBUG', undefined, `analyzePath: found ResourceReference`, {
          basePath,
          remainingPath,
          resourceType: value.resourceType,
          resourceId: value.resourceId,
        })

        // Use cached path analysis for performance
        let relationshipsNeeded: string[] = []
        if (remainingPath) {
          relationshipsNeeded = await this.getCachedPathAnalysis(value.resourceType, remainingPath)

          this.log('DEBUG', undefined, `analyzePath: relationships analysis`, {
            remainingPath,
            relationshipsNeeded,
          })
        }

        return {
          baseResourcePath: basePath,
          baseResourceRef: value,
          remainingPath,
          relationshipsNeeded,
        }
      }

      // CORE BUG FIX: Check if this is a previously loaded resource in cache.
      // When ResourceReference is replaced with data, subsequent accesses to
      // different fields on the same resource fail. By checking the cache,
      // we can retrieve the original ResourceReference for path analysis.
      const cachedEntry = this.lazyLoadCache.get(basePath)
      if (cachedEntry?.resourceRef) {
        const remainingPath = segments.slice(i).join('.')

        this.log('DEBUG', undefined, `analyzePath: found cached resource`, {
          basePath,
          remainingPath,
          resourceType: cachedEntry.resourceRef.resourceType,
          resourceId: cachedEntry.resourceRef.resourceId,
        })

        // Use cached path analysis for performance
        let relationshipsNeeded: string[] = []
        if (remainingPath) {
          relationshipsNeeded = await this.getCachedPathAnalysis(
            cachedEntry.resourceRef.resourceType,
            remainingPath
          )

          this.log('DEBUG', undefined, `analyzePath: relationships analysis (cached resource)`, {
            remainingPath,
            relationshipsNeeded,
          })
        }

        return {
          baseResourcePath: basePath,
          baseResourceRef: cachedEntry.resourceRef,
          remainingPath,
          relationshipsNeeded,
        }
      }
    }

    // No resource reference found
    this.log('DEBUG', undefined, `analyzePath: no ResourceReference found`, { path })
    return {
      baseResourcePath: '',
      baseResourceRef: null,
      remainingPath: path,
      relationshipsNeeded: [],
    }
  }

  /**
   * Lazy load a resource with required relationships
   * Updated to pass DB context for custom entity relationship loading
   *
   * Uses cache to avoid re-fetching. If some relationships are already loaded,
   * only fetches the missing ones and merges them in.
   *
   * @param ref - Resource reference to load
   * @param basePath - Cache key (e.g., "crud1.ticket")
   * @param relationshipsNeeded - Relationships to ensure are loaded
   * @returns Loaded resource with all requested relationships
   */
  private async lazyLoadResourceWithPath(
    ref: ResourceReference,
    basePath: string,
    relationshipsNeeded: string[]
  ): Promise<any> {
    const cacheKey = basePath

    // Check cache - do we already have what we need?
    const cached = this.lazyLoadCache.get(cacheKey)
    if (cached) {
      const missingRelationships = relationshipsNeeded.filter(
        (r) => !cached.fetchedRelationships.has(r)
      )

      if (missingRelationships.length === 0) {
        this.log('DEBUG', undefined, `lazyLoad: cache hit (all relationships loaded)`, {
          cacheKey,
          relationshipsRequested: relationshipsNeeded,
          fetchedRelationships: [...cached.fetchedRelationships],
        })
        return cached.data // All relationships already loaded
      }

      // Need to fetch additional relationships
      relationshipsNeeded = missingRelationships
    }

    // Circular reference detection
    if (this.loadingStack.has(cacheKey)) {
      this.log('WARN', undefined, `Circular reference detected: ${cacheKey}`)
      return null
    }

    this.loadingStack.add(cacheKey)

    try {
      this.log('DEBUG', undefined, `lazyLoad: fetching resource with relationships`, {
        resourceType: ref.resourceType,
        resourceId: ref.resourceId,
        relationshipsNeeded,
      })

      // Fetch resource with relationships, passing cached data to avoid redundant base fetch
      const recordId = toRecordId(ref.resourceType, ref.resourceId)
      const resource = await fetchResourceWithRelationships(
        recordId,
        relationshipsNeeded,
        ref.organizationId ?? this.context.organizationId,
        database,
        cached?.data
      )

      if (!resource) {
        this.log('WARN', undefined, `lazyLoad: resource not found`, {
          resourceType: ref.resourceType,
          resourceId: ref.resourceId,
        })
        return null
      }

      this.log('DEBUG', undefined, `lazyLoad: resource fetched`, {
        resourceType: ref.resourceType,
        hasRelationships: relationshipsNeeded.map((r) => ({
          name: r,
          exists: resource[r] !== undefined,
          isCollection: resource[r]?.values !== undefined,
        })),
      })

      // Merge with cached data if exists
      const mergedData = cached ? { ...cached.data, ...resource } : resource

      // Update cache - preserve original ResourceReference for subsequent lookups
      const entry: LazyLoadCacheEntry = {
        data: mergedData,
        fetchedAt: new Date(),
        fetchedRelationships: new Set([
          ...(cached?.fetchedRelationships || []),
          ...relationshipsNeeded,
        ]),
        resourceRef: cached?.resourceRef ?? ref, // Preserve original reference
      }

      this.lazyLoadCache.set(cacheKey, entry)

      // Replace resource reference with full object in variables
      // This allows subsequent accesses to skip lazy loading
      this.context.variables[basePath] = mergedData

      return mergedData
    } finally {
      this.loadingStack.delete(cacheKey)
    }
  }

  /**
   * Clear lazy load cache
   * Called at end of workflow execution to free memory
   */
  clearLazyLoadCache(): void {
    this.lazyLoadCache.clear()
    this.loadingStack.clear()
    this.pathAnalysisCache.clear()
    this.recordFieldCache.clear()
  }

  /**
   * Get cached path analysis result or perform analysis and cache it.
   * Same paths analyzed repeatedly now only require one DB lookup.
   */
  private async getCachedPathAnalysis(
    resourceType: string,
    remainingPath: string
  ): Promise<string[]> {
    const cacheKey = `${resourceType}:${remainingPath}`

    if (this.pathAnalysisCache.has(cacheKey)) {
      return this.pathAnalysisCache.get(cacheKey)!
    }

    const relationships = await analyzePathForRelationships(
      resourceType,
      remainingPath,
      this.context.organizationId
    )

    this.pathAnalysisCache.set(cacheKey, relationships)
    return relationships
  }

  // =============================================================================
  // RECORD FIELD CACHE
  // =============================================================================

  /** Create a FieldValueContext for batchGetValues calls */
  private createFieldValueContext(): FieldValueContext {
    const db = this.context.db ?? database
    return createFieldValueContext(this.context.organizationId, this.context.userId, db)
  }

  /**
   * Cache base entity data (id, entityDefinitionId, timestamps) for a record.
   * Called by find nodes when storing ResourceReference arrays to avoid re-fetching base data.
   */
  cacheRecordBase(
    recordId: RecordId,
    base: { id: string; entityDefinitionId: string; createdAt?: Date; updatedAt?: Date }
  ): void {
    const existing = this.recordFieldCache.get(recordId)
    if (existing) {
      existing.base = base
    } else {
      this.recordFieldCache.set(recordId, {
        base,
        fields: new Map(),
        allFieldsFetched: false,
      })
    }
  }

  /**
   * Batch prefetch field values for multiple records.
   * Delegates to batchGetValues, stores results in recordFieldCache.
   *
   * @param refs - ResourceReference array (from findMany output)
   * @param fieldRefs - FieldReference array (direct fields or relationship paths)
   */
  async prefetchFields(refs: ResourceReference[], fieldRefs: FieldReference[]): Promise<void> {
    if (refs.length === 0 || fieldRefs.length === 0) return

    const recordIds = refs.map((ref) => toRecordId(ref.resourceType, ref.resourceId))

    this.log('DEBUG', undefined, 'prefetchFields: calling batchGetValues', {
      recordCount: recordIds.length,
      fieldRefCount: fieldRefs.length,
      fieldRefs: fieldRefs.map((r) => (Array.isArray(r) ? r.join('::') : r)),
    })

    const ctx = this.createFieldValueContext()
    const result = await batchGetValues(ctx, { recordIds, fieldReferences: fieldRefs })

    this.log('DEBUG', undefined, 'prefetchFields: batchGetValues returned', {
      valueCount: result.values.length,
      sampleValues: result.values.slice(0, 3).map((v) => ({
        recordId: v.recordId,
        fieldRef: Array.isArray(v.fieldRef) ? v.fieldRef.join('::') : v.fieldRef,
        fieldType: v.fieldType,
        hasValue: v.value !== null,
      })),
    })

    // Store results in cache
    for (const entry of result.values) {
      const key = fieldRefToKey(entry.fieldRef)
      let record = this.recordFieldCache.get(entry.recordId)
      if (!record) {
        const parsed = parseRecordId(entry.recordId)
        record = {
          base: { id: parsed.entityInstanceId, entityDefinitionId: parsed.entityDefinitionId },
          fields: new Map(),
          allFieldsFetched: false,
        }
        this.recordFieldCache.set(entry.recordId, record)
      }
      record.fields.set(key, {
        typed: entry.value,
        fieldType: entry.fieldType,
        fieldOptions: entry.fieldOptions,
      })
    }
  }

  /**
   * Get a single cached field value, falling back to lazy batchGetValues on cache miss.
   *
   * @param recordId - RecordId of the record
   * @param fieldRef - FieldReference (direct field or relationship path)
   * @returns CachedFieldValue or null if field has no value
   */
  async getFieldValue(
    recordId: RecordId,
    fieldRef: FieldReference
  ): Promise<CachedFieldValue | null> {
    const key = fieldRefToKey(fieldRef)
    const record = this.recordFieldCache.get(recordId)

    // Cache hit
    if (record?.fields.has(key)) {
      return record.fields.get(key)!
    }

    // Cache miss — lazy fetch via batchGetValues for 1 record, 1 field
    const ctx = this.createFieldValueContext()
    const result = await batchGetValues(ctx, {
      recordIds: [recordId],
      fieldReferences: [fieldRef],
    })

    const entry = result.values[0]
    if (!entry) {
      return null
    }

    // Cache the result
    let cacheEntry = this.recordFieldCache.get(recordId)
    if (!cacheEntry) {
      const parsed = parseRecordId(recordId)
      cacheEntry = {
        base: { id: parsed.entityInstanceId, entityDefinitionId: parsed.entityDefinitionId },
        fields: new Map(),
        allFieldsFetched: false,
      }
      this.recordFieldCache.set(recordId, cacheEntry)
    }

    const cached: CachedFieldValue = {
      typed: entry.value,
      fieldType: entry.fieldType,
      fieldOptions: entry.fieldOptions,
    }
    cacheEntry.fields.set(key, cached)
    return cached
  }

  /**
   * Get the raw value for a field on a record.
   * Raw values are stripped of metadata (e.g., "john@example.com" instead of TypedFieldValue).
   */
  async getFieldRawValue(recordId: RecordId, fieldRef: FieldReference): Promise<unknown> {
    const cached = await this.getFieldValue(recordId, fieldRef)
    if (!cached) return undefined
    return formatToRawValue(cached.typed, cached.fieldType)
  }

  /**
   * Get the display-formatted value for a field on a record.
   * Display values are human-readable strings (e.g., "$1,234.50", "Jan 15, 2024").
   */
  async getFieldDisplayValue(recordId: RecordId, fieldRef: FieldReference): Promise<unknown> {
    const cached = await this.getFieldValue(recordId, fieldRef)
    if (!cached) return undefined
    return formatToDisplayValue(cached.typed, cached.fieldType, cached.fieldOptions)
  }

  /**
   * Materialize cached field values into plain objects for downstream consumption.
   * Builds objects with { ...base, fieldValues, displayValues } structure.
   *
   * Values are keyed by the field's output key (systemAttribute ?? key) to match
   * what getNestedValue and list operations expect (e.g., "name", "email").
   * Also keyed by fieldId (UUID) for ResourceFieldId-based lookups.
   *
   * @param refs - ResourceReference array
   * @param fieldRefs - FieldReference array (must already be prefetched)
   * @param entityFields - Optional entity field definitions for resolving output keys
   * @returns Array of plain objects with fieldValues and displayValues
   */
  async resolveRecordArray(
    refs: ResourceReference[],
    fieldRefs: FieldReference[],
    entityFields?: { id?: string; key: string; systemAttribute?: string }[]
  ): Promise<any[]> {
    // Build lookup: fieldId → output key (systemAttribute ?? key)
    const fieldOutputKeyMap = new Map<string, string>()
    if (entityFields) {
      for (const f of entityFields) {
        if (f.id) {
          fieldOutputKeyMap.set(f.id, f.systemAttribute ?? f.key)
        }
      }
    }

    // Enrich ACTOR typed values with displayName before formatting
    await this.enrichActorDisplayNames(refs, fieldRefs)

    return refs.map((ref) => {
      const recordId = toRecordId(ref.resourceType, ref.resourceId)
      const entry = this.recordFieldCache.get(recordId)
      if (!entry) return ref // Fallback: return ref as-is

      const fieldValues: Record<string, any> = {}
      const displayValues: Record<string, string> = {}

      for (const fieldRef of fieldRefs) {
        const cached = entry.fields.get(fieldRefToKey(fieldRef))
        if (!cached) continue

        const rawValue = formatToRawValue(cached.typed, cached.fieldType)
        const displayStr = stringifyDisplayValue(
          formatToDisplayValue(cached.typed, cached.fieldType, cached.fieldOptions)
        )

        // For field types where rawValue is an object (ACTOR, NAME), use the display
        // string so String() calls in join/pluck produce readable output
        const fieldValue =
          rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)
            ? displayStr
            : rawValue

        if (isFieldPath(fieldRef)) {
          const dotPath = fieldRef
            .map(
              (rfId) =>
                fieldOutputKeyMap.get(parseResourceFieldId(rfId).fieldId) ??
                parseResourceFieldId(rfId).fieldId
            )
            .join('.')
          setNestedValue(fieldValues, dotPath, fieldValue)
          setNestedValue(displayValues, dotPath, displayStr)
        } else {
          const { fieldId } = parseResourceFieldId(fieldRef as ResourceFieldId)
          const outputKey = fieldOutputKeyMap.get(fieldId) ?? fieldId
          fieldValues[outputKey] = fieldValue
          displayValues[outputKey] = displayStr
          if (fieldId !== outputKey) {
            fieldValues[fieldId] = fieldValue
            displayValues[fieldId] = displayStr
          }
        }
      }

      return { ...entry.base, fieldValues, displayValues }
    })
  }

  /**
   * Batch-resolve actor display names and enrich cached TypedFieldValues.
   * After this, formatToDisplayValue on ACTOR fields returns the real name.
   */
  private async enrichActorDisplayNames(
    refs: ResourceReference[],
    fieldRefs: FieldReference[]
  ): Promise<void> {
    // Collect all actorIds from ACTOR-type cached values
    const actorIdSet = new Set<string>()
    const actorEntries: { entry: RecordFieldEntry; cacheKey: string; cached: CachedFieldValue }[] =
      []

    for (const ref of refs) {
      const recordId = toRecordId(ref.resourceType, ref.resourceId)
      const entry = this.recordFieldCache.get(recordId)
      if (!entry) continue

      for (const fieldRef of fieldRefs) {
        const cacheKey = fieldRefToKey(fieldRef)
        const cached = entry.fields.get(cacheKey)
        if (!cached || cached.fieldType !== 'ACTOR' || !cached.typed) continue

        const raw = formatToRawValue(cached.typed, cached.fieldType) as any
        if (raw?.actorId) {
          actorIdSet.add(raw.actorId)
          actorEntries.push({ entry, cacheKey, cached })
        }
      }
    }

    if (actorIdSet.size === 0) return

    try {
      const { ActorService } = await import('../../actors/actor-service')
      const actorService = new ActorService({
        db: this.context.db!,
        organizationId: this.context.organizationId,
        userId: this.context.userId ?? '',
      })
      const actors = await actorService.getByIds([...actorIdSet] as ActorId[])

      // Patch displayName onto cached TypedFieldValues so formatToDisplayValue uses it
      for (const { cached } of actorEntries) {
        const typed = cached.typed as any
        if (!typed) continue
        const raw = formatToRawValue(typed, cached.fieldType) as any
        const actor = raw?.actorId ? actors.get(raw.actorId) : undefined
        if (actor) {
          typed.displayName = actor.name
        }
      }
    } catch (err) {
      this.log('WARN', undefined, 'Failed to batch-resolve actor names', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Resolve a field value from a ResourceReference using a remaining dot-path.
   * Converts the dot-path to a FieldReference and fetches via getFieldValue.
   *
   * Used by resolveVariablePath when it encounters a ResourceReference
   * and needs to resolve a field access (e.g., "find1.contacts[0].email").
   */
  private async resolveFieldFromResourceRef(ref: ResourceReference, dotPath: string): Promise<any> {
    const recordId = toRecordId(ref.resourceType, ref.resourceId)

    this.log('DEBUG', undefined, 'resolveFieldFromResourceRef', {
      resourceType: ref.resourceType,
      resourceId: ref.resourceId,
      dotPath,
    })

    // Single-segment path = direct field access (e.g., "email")
    // Multi-segment path = could be relationship path or nested object access
    const segments = dotPath.split('.')

    // Try as direct field first (single segment)
    if (segments.length === 1) {
      const fieldRef = await this.resolveFieldKeyToRef(ref.resourceType, segments[0]!)
      this.log('DEBUG', undefined, 'resolveFieldFromResourceRef: single segment', {
        segment: segments[0],
        resolvedFieldRef: fieldRef,
      })
      if (fieldRef) {
        const cached = await this.getFieldValue(recordId, fieldRef)
        if (cached) {
          const result = cachedToFriendlyValue(cached)
          this.log('DEBUG', undefined, 'resolveFieldFromResourceRef: resolved', {
            fieldRef,
            fieldType: cached.fieldType,
            resultType: typeof result,
            result: typeof result === 'string' ? result.slice(0, 100) : String(result),
          })
          return result
        }
      }
      this.log('DEBUG', undefined, 'resolveFieldFromResourceRef: field not found', {
        segment: segments[0],
        fieldRef,
      })
      return undefined
    }

    // Multi-segment: try as relationship path first
    // Build FieldPath by querying the resource registry for field definitions
    const fieldPath = await this.buildFieldPath(ref.resourceType, segments)
    if (fieldPath) {
      const pathCached = await this.getFieldValue(recordId, fieldPath)
      if (pathCached) {
        return cachedToFriendlyValue(pathCached)
      }
    }

    // Fallback: try first segment as direct field, navigate rest as nested object
    const directRef = await this.resolveFieldKeyToRef(ref.resourceType, segments[0]!)
    if (directRef) {
      const directCached = await this.getFieldValue(recordId, directRef)
      if (directCached) {
        const rawValue = formatToRawValue(directCached.typed, directCached.fieldType)
        if (typeof rawValue === 'object' && rawValue !== null && segments.length > 1) {
          return this.resolveNestedObject(rawValue, segments.slice(1).join('.'))
        }
        return cachedToFriendlyValue(directCached)
      }
    }

    return undefined
  }

  /**
   * Resolve a field key or UUID to a ResourceFieldId by looking up the entity field registry.
   * Field keys (e.g., "name", "email") need to be mapped to their UUID for batchGetValues.
   */
  private async resolveFieldKeyToRef(
    entityDefId: string,
    fieldKeyOrId: string
  ): Promise<ResourceFieldId | null> {
    try {
      const fields = await getCachedResourceFields(this.context.organizationId, entityDefId)
      const field = fields?.find((f) => f.key === fieldKeyOrId || f.id === fieldKeyOrId)
      if (field?.id) {
        return toResourceFieldId(entityDefId, field.id) as ResourceFieldId
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Try to build a FieldPath from dot-separated segments by checking the resource registry.
   * Returns null if the segments don't form a valid relationship path.
   */
  private async buildFieldPath(
    startEntityId: string,
    segments: string[]
  ): Promise<FieldReference | null> {
    try {
      const fields = await getCachedResourceFields(this.context.organizationId, startEntityId)

      if (!fields || fields.length === 0) return null

      // Check if first segment is a relationship field
      const firstField = fields.find(
        (f) => (f.key === segments[0] || f.id === segments[0]) && f.fieldType === 'RELATIONSHIP'
      )
      if (!firstField || !firstField.id) return null

      // For single remaining segment after relationship, build 2-element path
      if (segments.length === 2) {
        const relConfig = (firstField.options as any)?.relationship
        const targetEntityId = relConfig?.relatedEntityDefinitionId
        if (!targetEntityId) return null

        const firstRef = toResourceFieldId(startEntityId, firstField.id) as ResourceFieldId
        const secondRef = toResourceFieldId(targetEntityId, segments[1]!) as ResourceFieldId
        return [firstRef, secondRef]
      }

      // For deeper paths, recursively build
      // (simplified: only handle 2-deep for now)
      return null
    } catch {
      return null
    }
  }

  /**
   * Get all variables
   */
  getAllVariables(): Record<string, any> {
    return { ...this.context.variables }
  }

  /**
   * Set multiple variables at once
   */
  setVariables(variables: Record<string, any>): void {
    Object.entries(variables).forEach(([key, value]) => {
      this.setVariable(key, value)
    })
  }

  /**
   * Initialize environment variables from workflow configuration
   */
  initializeEnvironmentVariables(envVars: any[]): void {
    if (!envVars || !Array.isArray(envVars)) return

    envVars.forEach((envVar) => {
      if (envVar.name && envVar.value !== undefined) {
        // Store environment variables with 'env.' prefix
        this.setVariable(`env.${envVar.name}`, envVar.value)
        // this.log('DEBUG', undefined, `Environment variable loaded: ${envVar.name}`, {
        //   type: envVar.type,
        //   hasValue: envVar.value !== undefined && envVar.value !== null,
        // })
      }
    })
  }

  /**
   * Initialize schema-based variables from trigger data (message, order, etc.)
   */
  initializeSchemaVariables(schemaName: string, data: any): void {
    if (!data || typeof data !== 'object') return

    // Store schema data with schema prefix (e.g., 'message.', 'order.')
    Object.entries(data).forEach(([key, value]) => {
      this.setVariable(`${schemaName}.${key}`, value)
    })

    this.log('DEBUG', undefined, `Schema variables initialized: ${schemaName}`, {
      fieldCount: Object.keys(data).length,
    })
  }

  /**
   * Initialize system variables
   */
  initializeSystemVariables(): void {
    const systemVars = {
      'sys.currentTime': new Date().toISOString(),
      'sys.userId': this.context.userId,
      'sys.userEmail': this.userEmail,
      'sys.userName': this.userName,
      'sys.organizationId': this.context.organizationId,
      'sys.organizationName': this.organizationName,
      'sys.organizationHandle': this.organizationHandle,
      'sys.workflowId': this.context.workflowId,
      'sys.executionId': this.context.executionId,
    }

    Object.entries(systemVars).forEach(([key, value]) => {
      if (value !== undefined) {
        this.setVariable(key, value)
      }
    })

    // this.log('DEBUG', undefined, 'System variables initialized', {
    //   variableCount: Object.keys(systemVars).filter(
    //     (k) => systemVars[k as keyof typeof systemVars] !== undefined
    //   ).length,
    // })
  }

  /**
   * Check if a variable exists
   */
  hasVariable(key: string): boolean {
    return key in this.context.variables
  }

  /**
   * Delete a variable
   */
  deleteVariable(key: string): void {
    delete this.context.variables[key]
    this.log('DEBUG', undefined, `Variable deleted: ${key}`)
  }

  /**
   * Set current node being executed
   */
  setCurrentNode(nodeId: string): void {
    this.context.currentNodeId = nodeId
    this.context.visitedNodes.add(nodeId)
    this.log('DEBUG', nodeId, 'Node execution started')
  }

  /**
   * Get current node ID
   */
  getCurrentNode(): string | undefined {
    return this.context.currentNodeId
  }

  /**
   * Check if a node has been visited
   */
  hasVisitedNode(nodeId: string): boolean {
    return this.context.visitedNodes.has(nodeId)
  }

  /**
   * Get all visited nodes
   */
  getVisitedNodes(): string[] {
    return Array.from(this.context.visitedNodes)
  }

  /**
   * Add a log entry
   */
  log(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    nodeId: string | undefined,
    message: string,
    data?: any
  ): void {
    const logEntry: ExecutionLog = { timestamp: new Date(), level, nodeId, message, data }

    this.context.logs.push(logEntry)

    // Also log to the main logger
    const logMessage = nodeId ? `[${nodeId}] ${message}` : message
    switch (level) {
      case 'DEBUG':
        logger.debug(logMessage, { executionId: this.context.executionId, data })
        break
      case 'INFO':
        logger.info(logMessage, { executionId: this.context.executionId, data })
        break
      case 'WARN':
        logger.warn(logMessage, { executionId: this.context.executionId, data })
        break
      case 'ERROR':
        logger.error(logMessage, { executionId: this.context.executionId, data })
        break
    }
  }

  /**
   * Get all logs
   */
  getLogs(): ExecutionLog[] {
    return [...this.context.logs]
  }

  /**
   * Get logs for a specific node
   */
  getNodeLogs(nodeId: string): ExecutionLog[] {
    return this.context.logs.filter((log) => log.nodeId === nodeId)
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'): ExecutionLog[] {
    return this.context.logs.filter((log) => log.level === level)
  }

  /**
   * Clear logs (useful for long-running workflows)
   */
  clearLogs(): void {
    this.context.logs = []
  }

  /**
   * Get the full context (read-only)
   */
  getContext(): Readonly<ExecutionContext> {
    return { ...this.context }
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.context.debug = enabled
    this.log('INFO', undefined, `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.context.debug === true
  }

  /**
   * Get execution duration so far
   */
  getExecutionDuration(): number {
    return Date.now() - this.context.startedAt.getTime()
  }

  /**
   * Create a child context for parallel execution
   */
  createChildContext(childExecutionId: string): ExecutionContextManager {
    const childManager = new ExecutionContextManager(
      this.context.workflowId,
      childExecutionId,
      this.context.organizationId,
      this.context.userId,
      this.userEmail,
      this.userName,
      this.organizationName,
      this.organizationHandle
    )

    // Copy variables and state
    childManager.context.message = this.context.message
    childManager.context.triggerData = this.context.triggerData
    childManager.context.variables = { ...this.context.variables }
    childManager.context.debug = this.context.debug

    return childManager
  }

  /**
   * Merge results from a child context
   */
  mergeChildContext(childManager: ExecutionContextManager): void {
    // Merge variables (child variables take precedence)
    this.context.variables = { ...this.context.variables, ...childManager.context.variables }

    // Merge visited nodes
    childManager.context.visitedNodes.forEach((nodeId) => {
      this.context.visitedNodes.add(nodeId)
    })

    // Merge logs
    this.context.logs.push(...childManager.context.logs)
  }

  /**
   * Serialize context for persistence
   */
  serialize(): string {
    const { db, ...serializableContext } = this.context
    return safeJsonStringify({
      ...serializableContext,
      visitedNodes: Array.from(this.context.visitedNodes),
      options: this.options,
    })
  }

  /**
   * Deserialize context from persistence
   */
  static deserialize(serializedContext: string): ExecutionContextManager {
    const data = safeJsonParse(serializedContext)
    const manager = new ExecutionContextManager(
      data.workflowId,
      data.executionId,
      data.organizationId,
      data.userId,
      data.variables?.['sys.userEmail'],
      data.variables?.['sys.userName'],
      data.variables?.['sys.organizationName'],
      data.variables?.['sys.organizationHandle']
    )

    manager.context = {
      ...data,
      visitedNodes: new Set(data.visitedNodes || []),
      startedAt: new Date(data.startedAt),
    }

    // Restore options if available
    if (data.options) {
      manager.options = data.options
    }

    return manager
  }

  /**
   * Get all system variables (with sys. prefix)
   */
  getSystemVariables(): Record<string, any> {
    const systemVars: Record<string, any> = {}
    Object.entries(this.context.variables).forEach(([key, value]) => {
      if (key.startsWith('sys.')) {
        systemVars[key] = value
      }
    })
    return systemVars
  }

  /**
   * Get all environment variables (with env. prefix)
   */
  getEnvironmentVariables(): Record<string, any> {
    const envVars: Record<string, any> = {}
    Object.entries(this.context.variables).forEach(([key, value]) => {
      if (key.startsWith('env.')) {
        envVars[key] = value
      }
    })
    return envVars
  }

  /**
   * Get trigger data from context
   */
  getTriggerData(): Record<string, any> {
    return this.context.triggerData || {}
  }

  /**
   * Get all node variables grouped by node ID
   */
  getAllNodeVariables(): Record<string, Record<string, any>> {
    const nodeVars: Record<string, Record<string, any>> = {}

    Object.entries(this.context.variables).forEach(([key, value]) => {
      // Node variables are in format "nodeId.variableName"
      const match = key.match(/^([^.]+)\.(.+)$/)
      if (match && !key.startsWith('sys.') && !key.startsWith('env.')) {
        const [, nodeId, varName] = match
        if (nodeId && varName) {
          if (!nodeVars[nodeId]) {
            nodeVars[nodeId] = {}
          }
          nodeVars[nodeId][varName] = value
        }
      }
    })

    return nodeVars
  }

  /**
   * Pre-validate that required variables are available
   * Returns validation result with missing and available variables
   *
   * This enables better error messages by identifying:
   * - Which variables are missing
   * - Which variables are available as alternatives
   * - Which upstream nodes might provide the missing variables
   *
   * @param requiredVariables - Array of variable IDs (e.g., ["webhook1.body.email"])
   * @returns Validation result with detailed information
   *
   * @example
   * const result = contextManager.validateRequiredVariables(['webhook1.body.email', 'find1.ticket'])
   * if (!result.valid) {
   *   console.log('Missing:', result.missingVariables) // ['find1.ticket']
   *   console.log('Available:', result.availableVariables) // ['webhook1.body.email', 'webhook1.body.subject']
   * }
   */
  async validateRequiredVariables(requiredVariables: string[]): Promise<{
    valid: boolean
    missingVariables: string[]
    availableVariables: string[]
    partialMatches: Array<{ requested: string; available: string[] }>
  }> {
    const missing: string[] = []
    const available: string[] = []
    const partialMatches: Array<{ requested: string; available: string[] }> = []

    for (const varId of requiredVariables) {
      const value = await this.getVariable(varId)

      if (value === undefined) {
        // Variable not found
        missing.push(varId)

        // Find partial matches (e.g., user wants "find1.ticket.id" but "find1.ticket" exists)
        const parts = varId.split('.')
        const nodeId = parts[0]
        const matches: string[] = []

        // Check if base node exists and find similar paths
        for (const key of Object.keys(this.context.variables)) {
          if (key.startsWith(nodeId + '.')) {
            matches.push(key)
          }
        }

        if (matches.length > 0) {
          partialMatches.push({ requested: varId, available: matches })
        }
      } else {
        available.push(varId)
      }
    }

    return {
      valid: missing.length === 0,
      missingVariables: missing,
      availableVariables: available,
      partialMatches,
    }
  }

  /**
   * Build execution context with only required variables
   * More efficient than including all variables
   *
   * Use this when you want to:
   * - Pass minimal context to external services (AI, HTTP)
   * - Reduce memory usage for large contexts
   * - Cache variable resolution results
   * - Log only relevant variables
   *
   * FIXED: Now async and properly awaits getVariable calls.
   * Previously returned Promises instead of resolved values.
   *
   * @param requiredVariables - Array of variable IDs to include
   * @returns Map of only the required variables with their values
   *
   * @example
   * const optimizedContext = await contextManager.buildOptimizedContext(['webhook1.body.email'])
   * // Returns: Map { 'webhook1.body.email' => 'user@example.com' }
   * // Instead of: Map with ALL variables (webhook1.body.*, webhook1.headers.*, etc.)
   */
  async buildOptimizedContext(requiredVariables: string[]): Promise<Map<string, unknown>> {
    const optimizedContext = new Map<string, unknown>()

    // Parallelize all getVariable calls for efficiency
    const results = await Promise.all(
      requiredVariables.map(async (varId) => ({
        varId,
        value: await this.getVariable(varId),
      }))
    )

    for (const { varId, value } of results) {
      if (value !== undefined) {
        optimizedContext.set(varId, value)
      }
    }

    return optimizedContext
  }

  /**
   * Get all available variable IDs in current context
   * Useful for debugging and error messages
   *
   * @returns Array of all variable IDs currently available
   */
  getAvailableVariableIds(): string[] {
    return Object.keys(this.context.variables).sort()
  }

  /**
   * Get variables grouped by source node
   * Useful for understanding which nodes produced which variables
   *
   * @returns Map of nodeId to array of variable paths
   *
   * @example
   * const grouped = contextManager.getVariablesByNode()
   * // Returns: Map {
   * //   'webhook1' => ['webhook1.body.email', 'webhook1.body.subject', 'webhook1.headers'],
   * //   'find1' => ['find1.ticket.id', 'find1.ticket.status']
   * // }
   */
  getVariablesByNode(): Map<string, string[]> {
    const grouped = new Map<string, string[]>()

    for (const key of Object.keys(this.context.variables)) {
      const nodeId = key.split('.')[0]
      if (!nodeId) continue

      if (!grouped.has(nodeId)) {
        grouped.set(nodeId, [])
      }
      grouped.get(nodeId)!.push(key)
    }

    return grouped
  }

  /**
   * Get execution path (list of visited node IDs in order)
   */
  getExecutionPath(): string[] {
    // For now, return visited nodes as array
    // In future, we might want to track the actual order
    return Array.from(this.context.visitedNodes)
  }

  /**
   * Mark a node as visited
   */
  markNodeVisited(nodeId: string): void {
    this.context.visitedNodes.add(nodeId)
  }

  /**
   * Initialize join state for tracking branch convergence
   */
  async initializeJoinState(
    joinNodeId: string,
    forkNodeId: string,
    expectedInputs: string[]
  ): Promise<void> {
    if (!this.context.joinStates) {
      this.context.joinStates = {}
    }

    // Generate loop-aware join key if in a loop
    const joinKey = this.generateLoopAwareJoinKey(joinNodeId)

    // V5: Use JoinState class constructor
    const joinState = new JoinState(joinNodeId, forkNodeId, expectedInputs)

    this.context.joinStates[joinKey] = joinState

    // Cache the join state
    joinStateCache.set(this.context.executionId, joinNodeId, joinState)

    this.log('DEBUG', joinNodeId, `Join state initialized`, {
      joinKey,
      forkNodeId,
      expectedInputs,
      expectedCount: expectedInputs.length,
      loopContext: this.getLoopContext(),
    })
  }

  /**
   * Mark a branch as arrived at a join point and check if all branches have converged
   */
  async markBranchAsArrived(
    joinNodeId: string,
    predecessorNodeId: string,
    result: BranchResult
  ): Promise<boolean> {
    const joinKey = this.generateLoopAwareJoinKey(joinNodeId)

    if (!this.context.joinStates?.[joinKey]) {
      throw new Error(`Join state not found for ${joinNodeId} (key: ${joinKey})`)
    }

    const joinState = this.context.joinStates[joinKey]

    // Check if we should use batched updates for high-throughput scenarios
    const useBatchedUpdates =
      this.options?.useBatchedJoinUpdates || joinState.expectedInputs.size > 10 // Auto-enable for many branches

    if (useBatchedUpdates) {
      // Queue the update in the batched updater
      await batchedJoinUpdater.addBranchArrival(
        this.context.executionId,
        joinNodeId,
        predecessorNodeId,
        result
      )

      // For batched updates, we need to check the state after adding
      // In a real implementation, this would be handled by the batch processor
      // For now, we'll still update the local state
    }

    // Add the predecessor to completed inputs
    joinState.completedInputs.add(predecessorNodeId)

    // Store the branch result
    joinState.branchResults[predecessorNodeId] = { ...result, completedAt: new Date() }

    this.log('INFO', joinNodeId, `Branch arrived from ${predecessorNodeId}`, {
      status: result.status,
      completedCount: joinState.completedInputs.size,
      expectedCount: joinState.expectedInputs.size,
      batched: useBatchedUpdates,
    })

    // Update cache with latest state
    joinStateCache.set(this.context.executionId, joinNodeId, joinState)

    // Check if all expected branches have arrived
    const allBranchesArrived = joinState.expectedInputs.size === joinState.completedInputs.size

    if (allBranchesArrived) {
      this.log('INFO', joinNodeId, 'All branches have converged')
    }

    return allBranchesArrived
  }

  /**
   * Get the current join state for a node
   */
  async getJoinState(joinNodeId: string): Promise<JoinState | undefined> {
    const joinKey = this.generateLoopAwareJoinKey(joinNodeId)

    // Check cache first
    const cached = joinStateCache.get(this.context.executionId, joinNodeId)
    if (cached) {
      return cached
    }

    // Fall back to context
    const state = this.context.joinStates?.[joinKey]
    if (state) {
      // Update cache
      joinStateCache.set(this.context.executionId, joinNodeId, state)
    }

    return state
  }

  /**
   * Get join information for a node (stub for now - will be implemented with graph integration)
   */
  async getJoinInfo(joinNodeId: string): Promise<JoinPointInfo | undefined> {
    // This will be implemented when integrated with the workflow graph
    // For now, return a default configuration
    const joinState = this.context.joinStates?.[joinNodeId]
    if (!joinState) return undefined

    return {
      nodeId: joinNodeId,
      expectedInputs: joinState.expectedInputs,
      joinType: 'all',
      mergeStrategy: { type: 'merge-all' },
    }
  }

  /**
   * Clean up join state after successful convergence
   */
  async cleanupJoinState(joinNodeId: string): Promise<void> {
    const joinKey = this.generateLoopAwareJoinKey(joinNodeId)
    if (this.context.joinStates?.[joinKey]) {
      delete this.context.joinStates[joinKey]
      // Invalidate cache
      joinStateCache.invalidate(this.context.executionId, joinNodeId)
      this.log('DEBUG', joinNodeId, 'Join state cleaned up', { joinKey })
    }
  }

  /**
   * Create an isolated context for branch execution
   */
  createIsolatedBranchContext(branchExecutionId: string): ExecutionContextManager {
    const branchManager = new ExecutionContextManager(
      this.context.workflowId,
      branchExecutionId,
      this.context.organizationId,
      this.context.userId,
      this.userEmail,
      this.userName,
      this.organizationName,
      this.organizationHandle
    )

    // Copy only the necessary state, not the join states
    branchManager.context.message = this.context.message
    branchManager.context.triggerData = this.context.triggerData
    branchManager.context.variables = { ...this.context.variables }
    branchManager.context.debug = this.context.debug

    // V5: Set explicit branch context flag
    branchManager.context.isBranchContext = true
    branchManager.context.parentExecutionId = this.context.executionId

    // Copy execution options (including workflowRunId for cancellation/resume)
    if (this.options) {
      branchManager.setOptions(this.options)
    }

    return branchManager
  }

  /**
   * Get variable changes made by a branch (compared to initial state)
   */
  getVariableChanges(): Record<string, any> {
    // This would compare current variables against initial state
    // For now, return all variables as changes
    return { ...this.context.variables }
  }

  /**
   * Apply merged variables from branch convergence
   * Used after join points merge branch results
   */
  applyMergedVariables(mergedVars: Record<string, any>): void {
    for (const [key, value] of Object.entries(mergedVars)) {
      this.setVariable(key, value)
    }

    this.log('DEBUG', undefined, 'Applied merged variables from join', {
      count: Object.keys(mergedVars).length,
      variables: Object.keys(mergedVars),
    })
  }

  /**
   * Set node input for execution
   */
  setNodeInput(nodeId: string, input: any): void {
    this.setNodeVariable(nodeId, 'input', input)
  }

  /**
   * Get current loop context (if any)
   * Uses direct variable access since loop variables are always stored directly (not lazy-loaded)
   */
  getLoopContext(): { loopId: string; currentIteration: number } | null {
    // This will be implemented by LoopContextManager when needed
    // For now, check if we have any loop variables set
    // Use direct access since loop variables are simple values, not lazy-loaded resources
    const loopIndex = this.context.variables['loop.index']
    const loopTotal = this.context.variables['loop.total']

    if (loopIndex !== undefined && loopTotal !== undefined) {
      // Try to find the active loop ID from context
      // This is a simplified version - real implementation would track active loops
      return {
        loopId: 'current-loop', // Placeholder
        currentIteration: loopIndex as number,
      }
    }

    return null
  }

  /**
   * Generate a loop-aware join key for proper isolation in loops
   */
  private generateLoopAwareJoinKey(joinNodeId: string): string {
    const loopContext = this.getLoopContext()
    if (loopContext) {
      // Create unique key per loop iteration
      return `${joinNodeId}:loop-${loopContext.loopId}:iter-${loopContext.currentIteration}`
    }
    return joinNodeId
  }

  /**
   * Set file variable from workflow file data
   */
  setWorkflowFileVariable(
    nodeId: string,
    path: string,
    fileData: WorkflowFileData | WorkflowFileData[]
  ): void {
    let fileVariable: any

    if (Array.isArray(fileData)) {
      fileVariable = createMultipleFilesVariable(nodeId, path, fileData)
    } else {
      fileVariable = createFileVariable(nodeId, path, fileData)
    }

    // Store in context
    this.setVariable(fileVariable.fullPath, fileVariable)

    // Store convenient access paths
    if (Array.isArray(fileData)) {
      this.setVariable(`${fileVariable.fullPath}.count`, fileData.length)
      this.setVariable(
        `${fileVariable.fullPath}.totalSize`,
        fileData.reduce((sum: number, f: WorkflowFileData) => sum + f.size, 0)
      )
    } else {
      this.setVariable(`${fileVariable.fullPath}.filename`, fileData.filename)
      this.setVariable(`${fileVariable.fullPath}.size`, fileData.size)
      this.setVariable(`${fileVariable.fullPath}.url`, fileData.url)
    }

    this.log('DEBUG', nodeId, `File variable set: ${path}`, {
      type: Array.isArray(fileData) ? 'multiple' : 'single',
      count: Array.isArray(fileData) ? fileData.length : 1,
    })
  }

  /**
   * Get workflow file data for AI processing (future extension).
   * Uses direct variable access since file variables are stored directly (not lazy-loaded).
   */
  getWorkflowFile(key: string): WorkflowFileData | null {
    const variable = this.context.variables[key]
    if (!variable || variable.type !== 'file') {
      return null
    }
    return variable.properties?.file || null
  }

  /**
   * Get multiple workflow files.
   * Uses direct variable access since file variables are stored directly (not lazy-loaded).
   */
  getWorkflowFiles(key: string): WorkflowFileData[] {
    const variable = this.context.variables[key]
    if (!variable || variable.type !== 'array') {
      return []
    }
    return variable.properties?.files || []
  }

  // ============= File Context Service Integration =============

  private fileService: FileContextService | null = null

  /**
   * Get or create FileContextService (lazy initialization)
   * Used for URL refresh and content retrieval operations
   */
  getFileService(): FileContextService {
    if (!this.fileService) {
      // Import dynamically to avoid circular dependencies
      const { FileContextService } = require('../services/file-context-service')
      this.fileService = new FileContextService(this.context.db, this.context.organizationId)
    }
    return this.fileService
  }

  /**
   * Get file with fresh URL, refreshing if expired
   * Use this instead of getWorkflowFile for reliable access during long-running workflows
   *
   * @param key - Variable key for the file
   * @returns FileReference with valid URL, or null if not found
   */
  async getFileWithFreshUrl(key: string): Promise<FileReference | null> {
    const fileVar = this.context.variables[key]
    if (!fileVar) return null

    // Get file data from variable (could be wrapped in example property)
    const fileData = fileVar.example || fileVar

    // Normalize to FileReference using the service
    const fileRef = await this.getFileService().normalizeFileInput(
      fileData,
      fileVar.nodeId || key.split('.')[0] || 'unknown'
    )

    if (!fileRef) return null

    // Refresh URL if needed
    fileRef.url = await this.getFileService().getFreshUrl(fileRef)
    fileRef.urlExpiresAt = new Date(Date.now() + 3600000) // Assume 1 hour expiry

    return fileRef
  }

  /**
   * Get file content (binary) with automatic URL refresh
   *
   * @param key - Variable key for the file
   * @param options - Content retrieval options
   * @returns Buffer, base64 string, or stream depending on options
   */
  async getFileContent(
    key: string,
    options?: FileContentOptions
  ): Promise<Buffer | string | ReadableStream | null> {
    const fileRef = await this.getFileWithFreshUrl(key)
    if (!fileRef) return null

    return this.getFileService().getContent(fileRef, options || {})
  }
}

// =============================================================================
// RECORD FIELD CACHE HELPERS (module-level)
// =============================================================================

/** Convert a display value (unknown) to a string suitable for interpolation */
function stringifyDisplayValue(displayValue: unknown): string {
  if (displayValue == null) return ''
  if (typeof displayValue === 'string') return displayValue
  if (Array.isArray(displayValue)) {
    return displayValue.map((v) => stringifyDisplayValue(v)).join(', ')
  }
  return String(displayValue)
}

/**
 * Get a friendly value from a cached field value.
 * For field types where formatToRawValue returns an object (ACTOR, NAME),
 * returns the display string instead so String() calls produce readable output.
 */
function cachedToFriendlyValue(cached: CachedFieldValue): unknown {
  const raw = formatToRawValue(cached.typed, cached.fieldType)
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return stringifyDisplayValue(
      formatToDisplayValue(cached.typed, cached.fieldType, cached.fieldOptions)
    )
  }
  return raw
}

/** Set a value at a dot-separated path on an object, creating intermediate objects as needed */
function setNestedValue(obj: Record<string, any>, dotPath: string, value: any): void {
  const parts = dotPath.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]!] ??= {}
    current = current[parts[i]!]
  }
  current[parts[parts.length - 1]!] = value
}
