// packages/types/field/index.ts

/**
 * Branded string type for field identification.
 *
 * For custom fields: This is the database UUID from CustomField.id
 * For system fields: This is the field key (e.g., 'email', 'firstName')
 *
 * Example: "cm1abc123xyz" (custom) or "email" (system)
 */
export type FieldId = string & { readonly __brand: 'FieldId' }

/**
 * Branded string type for resource field identification.
 * Format: `${entityDefinitionId}:${fieldId}`
 *
 * Uniquely identifies a field within a specific resource/entity definition.
 *
 * Examples:
 * - "contact:email" (system field on contact)
 * - "ticket:cm1abc123xyz" (custom field on ticket)
 * - "cm2def456uvw:cm1abc123xyz" (custom field on custom entity)
 */
export type ResourceFieldId = string & { readonly __brand: 'ResourceFieldId' }

/**
 * Field path for relationship traversal.
 * Non-empty array of ResourceFieldId elements.
 *
 * Each element explicitly states which entity the field belongs to.
 * The path is validated by checking that related entities match.
 *
 * Examples:
 *   ["product:vendor", "vendor:name"]
 *     ↑                ↑
 *     |                └─ "name" field on "vendor" entity
 *     └──────────────── "vendor" field on "product" entity
 *
 *   ["product:vendor", "vendor:country", "country:name"]
 *     ↑                 ↑                  ↑
 *     |                 |                  └─ "name" on "country"
 *     |                 └──────────────────── "country" on "vendor"
 *     └────────────────────────────────────── "vendor" on "product"
 *
 *   ["vendor:products", "product:price"]  // has_many relationship
 */
export type FieldPath = [ResourceFieldId, ...ResourceFieldId[]] // At least 1 element

/**
 * Flexible field reference for data layer operations.
 *
 * Accepts:
 * - FieldId: Plain field identifier (e.g., "email", "cm123abc")
 *   → Auto-resolved to ResourceFieldId using recordId context
 * - ResourceFieldId: Scoped field identifier (e.g., "contact:email")
 * - FieldPath: Relationship traversal path (e.g., ["product:vendor", "vendor:name"])
 */
export type FieldReference = FieldId | ResourceFieldId | FieldPath

/**
 * A variable reference for a tool-input binding (plans/chat/v8 phase-2).
 *
 * It is a normal `FieldReference` rooted at an anchor entity, **except** a
 * segment's field part may be the connection-late-bound app form
 * `@app:<slug>:<key>` — resolved to a concrete `ResourceFieldId` at turn time
 * against the agent's bound connection:
 *
 * - `'contact:primary_email'`                                system field
 * - `'contact:<uuid>'`                                       custom field
 * - `'contact:@app:shopify:customerId'`                      app field on contact
 * - `['contact:company', 'company:@app:shopify:vendorTier']` app field on a traversal target
 * - `'contact:self'`                                         the anchor's own record id
 *
 * The anchor is **derived** from the ref's root entity (`getRootEntityId`) — it
 * is never stored separately, so an `{ anchor, ref }` mismatch is unrepresentable.
 */
export type VarRef = ResourceFieldId | FieldPath

/**
 * Source of a platform-resolved tool-input binding (plans/chat/v8 phase-2).
 *
 * - `var`   — a read-only value reached from the subject via a {@link VarRef}.
 * - `const` — an admin-pinned constant.
 * - `model` — explicitly left to the LLM (also the way to un-bind an author default).
 */
export type VarSource =
  | { kind: 'var'; ref: VarRef }
  | { kind: 'const'; value: unknown }
  | { kind: 'model' }

export type {
  ActorFieldOptions,
  ActorFieldValue,
  ActorGroupValue,
  ActorUserValue,
} from './actor-field'
export { fieldIdSchema, resourceFieldIdSchema } from './schema'
export {
  buildFieldValueKey,
  type FieldValueKey,
  fieldPathToString,
  fieldRefToKey,
  getFieldDefinitionId,
  getFieldId,
  getRootEntityId,
  getTargetFieldId,
  isFieldId,
  isFieldPath,
  isPlainFieldId,
  isResourceFieldId,
  keyToFieldRef,
  normalizeFieldRef,
  parseResourceFieldId,
  toFieldId,
  toFieldPath,
  toResourceFieldId,
  toResourceFieldIds,
  validateFieldPath,
} from './utils'
