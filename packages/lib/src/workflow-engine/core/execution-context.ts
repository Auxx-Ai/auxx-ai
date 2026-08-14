// packages/lib/src/workflow-engine/core/execution-context.ts

import { type Database, database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import type { ActorId } from '@auxx/types/actor'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
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
import type {
  ContextEntryDescriptor,
  ContextManager,
  ContextRef,
} from '../../ai/agent-framework/context'
import { getCachedResourceFields } from '../../cache'
import type { FieldOptions } from '../../custom-fields/field-options'
import {
  createFieldValueContext,
  type FieldValueContext,
} from '../../field-values/field-value-helpers'
import { batchGetValues } from '../../field-values/field-value-queries'
import { formatToDisplayValue, formatToRawValue } from '../../field-values/formatter'
import { primaryValue } from '../../field-values/primary-value'
import { getFieldOutputKey, type ResourceField } from '../../resources/registry/field-types'
import { fetchResourceWithRelationships } from '../../resources/resource-fetcher'
import { type PathSegment, parseVariablePath } from '../catalog/variable-inference'
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
import { BaseType, JoinState } from './types'

const logger = createScopedLogger('execution-context')

/** Configuration for the lazy load cache */
const LAZY_LOAD_CACHE_CONFIG = {
  /** Maximum number of cached resources */
  max: 100,
  /** Time-to-live in milliseconds (5 minutes) */
  ttl: 1000 * 60 * 5,
}

/**
 * Safety cap on the segment-walk resolver's relation-hop depth. Not a
 * capability limit — arbitrary relation depth "falls out" of hydrate-as-
 * you-walk by design — just a guard against a stored data cycle (or a
 * pathological path) recursing forever.
 */
const MAX_RELATION_HOPS = 4

/**
 * Structural properties every fetched/entity-object-shaped value carries
 * (never real CustomField/ResourceField registry entries) — the segment
 * walker resolves these directly off the loaded object, skipping the org
 * field-registry round-trip entirely. See `walkSegments`'s identity branch.
 */
const IDENTITY_META_KEYS = new Set(['id', 'entityDefinitionId', 'createdAt', 'updatedAt'])

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
 * Map a chat-v9 {@link ContextRef} onto the flat workflow path strings this
 * manager already resolves (`var:x` → `x`, `sys:userId` → `sys.userId`). A
 * small pure helper — the kopilot store parses refs richly; the workflow engine
 * only needs the legacy path form, since its `tool:*` capture is a Phase-3
 * concern and `var:`/`sys:` cover what workflow tools use today.
 */
function refToWorkflowPath(ref: ContextRef): string {
  if (Array.isArray(ref)) {
    // FieldPath traversal — workflow paths are dot-joined.
    return ref.join('.')
  }
  if (ref.startsWith('var:')) return ref.slice('var:'.length)
  if (ref.startsWith('sys:')) return `sys.${ref.slice('sys:'.length)}`
  if (ref.startsWith('tool:')) return ref.slice('tool:'.length)
  if (ref.startsWith('call:')) return ref.slice('call:'.length)
  return ref
}

/**
 * Manages workflow execution context including variables, state, and logging.
 *
 * Conforms to the chat-v9 {@link ContextManager} contract (the `read`/`write`/
 * `interpolate`/`captureToolResult`/`list` adapters below) so workflow AI nodes
 * can hand their live execution context to the agent framework as
 * `ToolContext.context`. The adapters are thin wrappers over the existing
 * methods — no behavior change. See plans/chat/v9/CONTEXT-VARIABLES-IMPLEMENTATION.md.
 */
export class ExecutionContextManager implements ContextManager {
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
   * Alias for `setVariable` used by the agent framework's `WorkflowToolContext`.
   * Lets workflow-native tools (`assign_variable`, future code-eval, etc.) reach
   * the active run's context without depending on workflow-engine internals.
   */
  assignVariable(name: string, value: unknown): void {
    this.setVariable(name, value)
  }

  // ===========================================================================
  // ContextManager conformance (chat v9) — thin adapters, no behavior change
  // ===========================================================================

  /** {@link ContextManager.read} — resolve a `ContextRef` via the workflow path resolver. */
  async read(ref: ContextRef): Promise<unknown> {
    return this.resolveVariablePath(refToWorkflowPath(ref))
  }

  /** {@link ContextManager.write} — set a `var:*` (or legacy) ref into a workflow variable. */
  async write(ref: ContextRef, value: unknown): Promise<void> {
    this.setVariable(refToWorkflowPath(ref), value)
  }

  /** {@link ContextManager.interpolate} — delegate to the existing `{{path}}` interpolation. */
  async interpolate(text: string): Promise<string> {
    return this.interpolateVariables(text)
  }

  /**
   * {@link ContextManager.captureToolResult} — no-op in the workflow engine.
   * Workflow tool outputs are exposed as node variables, not the turn-scoped
   * `tool:*` capture store; generic capture is a kopilot-store concern (Phase 3).
   */
  captureToolResult(_toolCallId: string, _toolName: string, _result: unknown): void {
    // intentionally empty — see method doc
  }

  /** {@link ContextManager.list} — enumerate current variables as resolvable refs. */
  list(): ContextEntryDescriptor[] {
    return Object.keys(this.context.variables).map((key) =>
      key.startsWith('sys.')
        ? { ref: `sys:${key.slice('sys.'.length)}` as ContextRef, kind: 'sys' as const }
        : { ref: `var:${key}` as ContextRef, kind: 'var' as const }
    )
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
   * Set multiple node-specific variables at once
   * @param nodeId The ID of the node
   * @param variables Record of path → value pairs to set
   */
  setNodeVariables(nodeId: string, variables: Record<string, any>): void {
    for (const [path, value] of Object.entries(variables)) {
      this.setNodeVariable(nodeId, path, value)
    }
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
   * Resolve a variable path with support for nested access, arrays, and
   * arbitrary-depth relation traversal — ONE recursive segment walk (see
   * `parseVariablePath`, `walkSegments`).
   *
   * Base resolution (before the walk starts) follows a fixed precedence:
   *   1. Longest prefix holding a `ResourceReference` or `lazyLoadCache`
   *      entry, searched longest→shortest. This runs BEFORE the exact-match
   *      lookup, so a stored ref at `n.<def>` SHADOWS a directly-stored
   *      scalar at `n.<def>.record_id` — crud/find write both shapes, and
   *      the ref's tolerant field resolution is what downstream paths need.
   *   2. Exact full-path stored value (a stored `null` — the findOne-miss
   *      contract — resolves here, since only an ABSENT key is `undefined`).
   *   3. Longest stored non-ref prefix, then walked (plain object/array nav).
   *   4. Miss → `undefined` + DEBUG log.
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
   *   "find1.vendor.region.parentRegion.name" → Lazy loads TWO relation hops
   */
  async resolveVariablePath(path: string): Promise<any> {
    if (!path) return undefined

    const rawSegments = path.split('.')
    const parsed = parseVariablePath(path)
    const keyPathUpTo = (i: number) =>
      parsed
        .slice(0, i)
        .map((s) => s.key)
        .join('.')

    // Step 1: longest ref/cache prefix, longest→shortest (INCLUDES the full
    // path — resolving a bare ref alone still triggers a load and returns
    // the loaded data, never the raw reference). The BOUNDARY segment
    // (`parsed[i - 1]`) may itself carry a `[n]`/`[*]` accessor even though
    // the stored key never includes brackets — its `index` must still be
    // applied to the loaded base, not silently dropped.
    for (let i = rawSegments.length; i > 0; i--) {
      const basePath = keyPathUpTo(i)
      const stored = this.context.variables[basePath]
      if (isResourceReference(stored)) {
        return this.walkFromRef(stored, basePath, parsed[i - 1]!.index, parsed.slice(i))
      }
      const cachedEntry = this.lazyLoadCache.get(basePath)
      if (cachedEntry?.resourceRef) {
        return this.walkFromRef(
          cachedEntry.resourceRef,
          basePath,
          parsed[i - 1]!.index,
          parsed.slice(i)
        )
      }
    }

    // Step 2/3: longest stored non-ref prefix — INCLUDING the full path
    // itself (an exact match is just the `i === length` case of "longest
    // stored prefix") — then walk the remainder, same boundary-index
    // caveat as step 1.
    for (let i = rawSegments.length; i > 0; i--) {
      const basePath = keyPathUpTo(i)
      const baseValue = this.context.variables[basePath]
      if (baseValue !== undefined) {
        return this.walkIndexed(baseValue, parsed[i - 1]!.index, parsed.slice(i), 0)
      }
    }

    this.log('DEBUG', undefined, `Variable not found: ${path}`)
    return undefined
  }

  /** Ensure `ref`'s base data is loaded, apply the boundary segment's own accessor if any, then walk. */
  private async walkFromRef(
    ref: ResourceReference,
    basePath: string,
    boundaryIndex: PathSegment['index'],
    remaining: PathSegment[]
  ): Promise<any> {
    const base = await this.lazyLoadResourceWithPath(ref, basePath, [])
    if (!base) return undefined
    return this.walkIndexed(base, boundaryIndex, remaining, 0)
  }

  /**
   * The segment walker. `value` is one of: an already-loaded resource
   * object (id + entityDefinitionId — a `ResourceReference` never reaches
   * here directly, `walkFromRef` always loads it first), an array, a plain
   * object, or a scalar/null/undefined. `hopCount` tracks relation hops
   * consumed so far, capped at `MAX_RELATION_HOPS`.
   */
  private async walkSegments(
    value: unknown,
    segments: PathSegment[],
    hopCount: number
  ): Promise<any> {
    if (segments.length === 0) return value
    const [seg, ...rest] = segments as [PathSegment, ...PathSegment[]]

    // Runtime-contextual array accessors (first/last/bare-digit) — NOT
    // grammar, only meaningful when `value` is already an array and this
    // segment carries no bracket of its own (a bracketed "items[0]" falls
    // through to plain-object nav below, matching pre-existing behavior).
    if (Array.isArray(value) && seg.index === undefined) {
      return this.walkSegments(this.arrayAccessor(value, seg.key), rest, hopCount)
    }

    // A loaded resource (custom entity or fetched relation target) — every
    // shape this codebase fetches (fetchResourceById, has_many items, …)
    // carries `id` + `entityDefinitionId`. Classify the next segment
    // against the org's canonical field registry with the tolerant
    // key/id/systemAttribute triad.
    const identity = this.identityOf(value)
    if (identity) {
      // The structural meta keys every fetched/entity-object-shaped value
      // carries resolve directly off `identity.base`, with NO registry
      // round-trip — deliberately NOT a check of arbitrary own-properties:
      // a relation ALREADY hydrated onto `base` (e.g. `region` after a
      // prior walk resolved it) must still go through classification below
      // on a LATER access, so a `rest`-dependent case like `.referenceId`
      // (see below) still gets a chance to intercept it. Some callers store
      // a lightweight "entity-object" shape that is ONLY `{ id,
      // entityDefinitionId }` (never lazy-loaded, e.g. `message-
      // received.ts`'s linked-ticket output) — for those this IS the only
      // lane that ever resolves a field, by design.
      if (IDENTITY_META_KEYS.has(seg.key) && identity.base?.[seg.key] !== undefined) {
        return this.walkIndexed(identity.base[seg.key], seg.index, rest, hopCount)
      }

      const field = await this.findResourceField(identity.resourceType, seg.key)

      if (
        field?.type === BaseType.RELATION &&
        field.relationship &&
        getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
      ) {
        const relConfig = field.relationship as RelationshipConfig
        // `.referenceId` is a SYNTHETIC declared property (`variable-
        // generators.ts`'s `convertFieldToVariableProperty`), not a field on
        // the target entity — it means "the raw related-entity id stored on
        // THIS record". Resolve it directly off the relation field's own
        // value; no need to hydrate the target at all.
        if (
          rest[0]?.key === 'referenceId' &&
          rest[0].index === undefined &&
          (relConfig.relationshipType === 'belongs_to' || relConfig.relationshipType === 'has_one')
        ) {
          const referenceId = await this.resolveReferenceId(identity, field)
          return this.walkSegments(referenceId, rest.slice(1), hopCount)
        }

        if (hopCount >= MAX_RELATION_HOPS) {
          this.log('WARN', undefined, `Relation hop cap (${MAX_RELATION_HOPS}) reached`, {
            resourceType: identity.resourceType,
            key: seg.key,
          })
          return undefined
        }
        const related = await this.hydrateRelation(identity, getFieldOutputKey(field))
        // A belongs_to/has_one that genuinely has no related record hydrates
        // to `null` (`fetchResourceWithRelationships`'s own miss contract) —
        // same "looked, found nothing" answer as a findOne miss (§3), so it
        // propagates as a resolved `null` rather than `undefined` when more
        // path remains (there's nothing further to look up either way).
        if (related === null && rest.length > 0) return null
        return this.walkIndexed(related, seg.index, rest, hopCount + 1)
      }

      if (field) {
        // Scalar field — through the record-field cache, unifying findOne
        // and findMany-item resolution onto one lane.
        const recordId = toRecordId(identity.resourceType, identity.resourceId)
        const fieldRef = toResourceFieldId(identity.resourceType, field.id)
        const cached = await this.getFieldValue(recordId, fieldRef)
        const friendly = cached ? cachedToFriendlyValue(cached) : undefined
        return this.walkIndexed(friendly, seg.index, rest, hopCount)
      }

      // Neither relation nor known field — fall through to plain-object
      // navigation on the loaded base record (preserves `.id`/
      // `.entityDefinitionId` resolution on ref bases).
      return this.walkIndexed(this.getProp(identity.base, seg.key), seg.index, rest, hopCount)
    }

    // Plain object — EXACT match only (+ fieldValues fallback). No key
    // tolerance here: tier-A raw rows must keep failing on systemAttribute
    // paths (§3.2 pins in parity/known-broken.ts assert broken-stays-broken).
    if (value !== null && typeof value === 'object') {
      return this.walkIndexed(this.getProp(value, seg.key), seg.index, rest, hopCount)
    }

    return undefined
  }

  /** Apply a segment's `[n]`/`[*]` accessor to a just-resolved value, then continue the walk. */
  private walkIndexed(
    value: unknown,
    index: PathSegment['index'],
    rest: PathSegment[],
    hopCount: number
  ): Promise<any> {
    if (index === undefined) return this.walkSegments(value, rest, hopCount)

    if (!Array.isArray(value)) {
      this.log('WARN', undefined, `Attempted array access on non-array value`)
      return Promise.resolve(undefined)
    }

    if (index === '*') return this.walkProjection(value, rest, hopCount)

    const idx = index < 0 ? value.length + index : index
    if (idx < 0 || idx >= value.length) {
      this.log('WARN', undefined, `Array index out of bounds: [${index}]`)
      return Promise.resolve(undefined)
    }
    return this.walkSegments(value[idx], rest, hopCount)
  }

  /**
   * `[*]` — map `walkSegments(item, rest)` over every item (the tail-drop
   * fix: the old resolver returned the raw array here). Batches the common
   * `<plural>[*].<scalar>` case: when every item is a `ResourceReference`
   * and the immediate next segment is a direct scalar field, one
   * `prefetchFields` call replaces the old per-item `batchGetValues` N+1.
   */
  private async walkProjection(
    items: unknown[],
    rest: PathSegment[],
    hopCount: number
  ): Promise<any> {
    if (rest.length === 0) return items

    const firstSeg = rest[0]!
    if (items.length > 0 && items.every(isResourceReference)) {
      const refs = items as ResourceReference[]
      const field = await this.findResourceField(refs[0]!.resourceType, firstSeg.key)
      if (field && field.type !== BaseType.RELATION) {
        await this.prefetchFields(refs, [toResourceFieldId(refs[0]!.resourceType, field.id)])
      }
    }

    return Promise.all(items.map((item) => this.walkSegments(item, rest, hopCount)))
  }

  /** `first`/`last`/bare-digit — runtime-contextual, applied only when `value` is already an array. */
  private arrayAccessor(value: unknown[], key: string): unknown {
    if (key === 'first') return value[0]
    if (key === 'last') return value[value.length - 1]
    if (/^\d+$/.test(key)) return value[Number.parseInt(key, 10)]
    this.log('WARN', undefined, `Non-accessor key "${key}" on array value`)
    return undefined
  }

  /** `obj[key]`, else `obj.fieldValues[key]`, else `undefined` — exact match only. */
  private getProp(obj: any, key: string): unknown {
    if (obj === null || typeof obj !== 'object') return undefined
    if (obj[key] !== undefined) return obj[key]
    if (obj.fieldValues && obj.fieldValues[key] !== undefined) return obj.fieldValues[key]
    return undefined
  }

  /**
   * Does `value` carry a resource identity the walker can classify fields
   * against? Two shapes:
   *   - a RAW `ResourceReference` (findMany items are stored this way —
   *     `find.ts` never eagerly loads them; `base` comes from whatever
   *     `cacheRecordBase`/a prior `getFieldValue` already cached, which may
   *     be the lightweight `{id, entityDefinitionId, createdAt, updatedAt}`
   *     shape rather than a full fetch — good enough for scalar-field
   *     classification and the id/entityDefinitionId fallback; relation
   *     hydration re-fetches the full base itself when needed, see
   *     `hydrateRelation`).
   *   - an already-LOADED resource object (id + entityDefinitionId, both
   *     strings — every shape this codebase fetches carries these).
   */
  private identityOf(
    value: unknown
  ): { resourceType: string; resourceId: string; base: any } | null {
    if (isResourceReference(value)) {
      const recordId = toRecordId(value.resourceType, value.resourceId)
      return {
        resourceType: value.resourceType,
        resourceId: value.resourceId,
        base: this.recordFieldCache.get(recordId)?.base ?? {},
      }
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as any).id === 'string' &&
      typeof (value as any).entityDefinitionId === 'string'
    ) {
      return {
        resourceType: (value as any).entityDefinitionId,
        resourceId: (value as any).id,
        base: value,
      }
    }
    return null
  }

  /**
   * The raw related-entity id stored on THIS record for a belongs_to/
   * has_one relation field — what `.referenceId` means in the declared
   * variable tree. Reads the relation field's own value (a `RecordId`
   * string, `"<entityDefinitionId>:<instanceId>"`) through the record-field
   * cache and returns just the instance-id half.
   */
  private async resolveReferenceId(
    identity: { resourceType: string; resourceId: string },
    field: ResourceField
  ): Promise<string | undefined> {
    const recordId = toRecordId(identity.resourceType, identity.resourceId)
    const fieldRef = toResourceFieldId(identity.resourceType, field.id)
    const cached = await this.getFieldValue(recordId, fieldRef)
    if (!cached) return undefined
    const raw = formatToRawValue(cached.typed, cached.fieldType)
    if (typeof raw !== 'string') return undefined
    try {
      return parseRecordId(raw as RecordId).entityInstanceId
    } catch {
      return undefined
    }
  }

  /**
   * Hydrate ONE relation field onto `identity`'s resource (a nested hop —
   * the top-level ref's own base load goes through
   * `lazyLoadResourceWithPath`, which has its own cache; this is for hops
   * beyond that, and for findMany items which are never eagerly loaded).
   * Skips the fetch if `identity.base` already carries the relation. Only
   * passes `identity.base` on as the fetch's `cachedResource` when it's a
   * FULL loaded object (has `fieldValues`) — the lightweight
   * `cacheRecordBase` shape isn't enough for `fetchResourceWithRelationships`
   * to read a belongs_to's stored related-id from, so a bare `undefined`
   * lets it fetch its own base fresh instead of reading through a hole.
   */
  private async hydrateRelation(
    identity: { resourceType: string; resourceId: string; base: any },
    outputKey: string
  ): Promise<any> {
    if (identity.base?.[outputKey] !== undefined) return identity.base[outputKey]
    const recordId = toRecordId(identity.resourceType, identity.resourceId)
    const cachedResource = identity.base?.fieldValues !== undefined ? identity.base : undefined
    const hydrated = await fetchResourceWithRelationships(
      recordId,
      [outputKey],
      this.context.organizationId,
      database,
      cachedResource
    )
    return hydrated ? hydrated[outputKey] : undefined
  }

  /**
   * Look up a `ResourceField` by the tolerant key/id/systemAttribute triad
   * — the single classification point the walker uses to decide relation
   * vs scalar vs "fall through to plain-object nav".
   */
  private async findResourceField(
    resourceType: string,
    key: string
  ): Promise<ResourceField | null> {
    const fields = await getCachedResourceFields(this.context.organizationId, resourceType)
    return fields?.find((f) => f.key === key || f.id === key || f.systemAttribute === key) ?? null
  }

  /**
   * True when `path`'s terminal segment names a multi-value SCALAR field
   * (`options.multi` on EMAIL/URL/PHONE/…) on a record — the case where an
   * array-shaped resolution represents "several values of one scalar field"
   * rather than a genuine list variable. Used by `interpolateVariables` to
   * substitute the primary (first) value into string templates.
   *
   * Resolves the parent path to classify the terminal key against the field
   * registry; both hops are cache-hits after the value resolution that
   * preceded this call (lazyLoadCache / recordFieldCache / org cache).
   */
  private async isMultiValueScalarFieldPath(path: string): Promise<boolean> {
    const segments = parseVariablePath(path)
    if (segments.length < 2) return false
    const last = segments[segments.length - 1]!
    // An explicit accessor (`email[1]`) never resolves to the whole array.
    if (last.index !== undefined) return false

    const parentPath = path.split('.').slice(0, -1).join('.')
    // A stored ResourceReference classifies without a load; otherwise resolve
    // the parent (cache-hit) and classify the loaded shape.
    const identity =
      this.identityOf(this.context.variables[parentPath]) ??
      this.identityOf(await this.resolveVariablePath(parentPath))
    if (!identity) return false

    const field = await this.findResourceField(identity.resourceType, last.key)
    return field != null && field.type !== BaseType.RELATION && field.options?.multi === true
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

      let value = await this.resolveVariablePath(path)

      // A multi-value scalar field (`options.multi` on EMAIL/URL/PHONE/…)
      // resolves as an array, and a string template is a scalar context — it
      // interpolates as the primary (first) value, never a joined list (a
      // send-email recipient of "a@x.com, b@x.com" is not an address). Genuine
      // array variables (tags, actionsPerformed, …) keep joining below.
      if (Array.isArray(value) && (await this.isMultiValueScalarFieldPath(path))) {
        value = primaryValue(value)
      }

      if (value === undefined || value === null) {
        this.log('WARN', undefined, `Variable not found during interpolation: ${path}`)
        result = result.replace(match[0], '')
        continue
      }

      // Convert value to string, escaping $ characters to prevent special replacement patterns
      // String.replace() treats $& $' $` $n specially in replacement strings
      let replacement: string
      if (typeof value === 'object') {
        replacement = this.formatForDisplay(value, path)
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
   * Falls back to heuristics (name/label/displayName/value properties) or
   * JSON.stringify for non-entity objects. Arrays are joined with ', '.
   *
   * Public so Phase 5's `buildMessages` rewrite can render a resolved-
   * variable Map into a Tiptap doc via `docToText(json, { variables })`.
   */
  public formatForDisplay(value: unknown, _variablePath: string): string {
    if (value == null) return ''
    if (typeof value !== 'object') return String(value)

    // For arrays, join elements
    if (Array.isArray(value)) {
      return value.map((v) => this.formatForDisplay(v, '')).join(', ')
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
    this.recordFieldCache.clear()
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
    if (this.fileService) return this.fileService

    // Import dynamically to avoid circular dependencies
    const { FileContextService } = require('../services/file-context-service')
    const service: FileContextService = new FileContextService(
      this.context.db,
      this.context.organizationId
    )
    this.fileService = service
    return service
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
