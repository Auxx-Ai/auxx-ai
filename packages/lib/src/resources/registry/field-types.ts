// packages/lib/src/resources/registry/field-types.ts

import type { FieldType } from '@auxx/database/types'
import type { FieldId, ResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { FieldOptions } from '../../custom-fields/field-options'
import type { BaseType } from '../types'

/**
 * Table-level metadata for a resource
 * Defines metadata about the resource table itself (not individual fields)
 */
export interface ResourceTableDefinition {
  /** Unique table identifier (e.g., 'ticket', 'contact') */
  readonly id: string
  /** Singular display label (e.g., 'Ticket', 'Contact') */
  readonly label: string
  /** Plural display label (e.g., 'Tickets', 'Contacts') */
  readonly plural: string
  /** Icon name for UI */
  readonly icon: string
  /** Color name for UI (e.g., 'blue', 'indigo', 'gray') */
  readonly color: string
  /** API slug (e.g., 'tickets', 'contacts') */
  readonly apiSlug: string
  /** Database table name */
  readonly dbName: string
}

/**
 * Field capabilities - determines what operations can be performed on a field
 */
export interface FieldCapabilities {
  /** Can use in Find node filters */
  filterable: boolean
  /** Can use for ordering in Find node */
  sortable: boolean
  /** Can set in CRUD create operation */
  creatable: boolean
  /** Can set field value in CRUD update operation */
  updatable: boolean
  /** Can edit field definition (name, type, description, etc.) */
  configurable: boolean
  /** Required for create operation */
  required?: boolean
  /** Field must contain unique values */
  unique?: boolean
  /** Field is computed/derived and cannot be directly set */
  computed?: boolean
  /**
   * Field exists in the registry and database but is invisible in every
   * user-facing UI (panel, column chooser, filter/sort pickers, import/export,
   * workflow variable pickers, custom-field list). System code can still
   * read/write it via Drizzle or UnifiedCrudHandler.
   */
  hidden?: boolean
}

/**
 * Validation rules for a field
 */
export interface FieldValidation {
  /** Minimum value for numbers or dates */
  min?: number
  /** Maximum value for numbers or dates */
  max?: number
  /** Regex pattern for string validation */
  pattern?: string
  /** Minimum length for strings */
  minLength?: number
  /** Maximum length for strings */
  maxLength?: number
}

/**
 * Unified field definition
 * Single source of truth for all resource field metadata
 */
export interface ResourceField {
  /**
   * Unique field identifier (branded type).
   *
   * For custom fields: Database UUID from CustomField.id
   * For system fields: Field key (e.g., 'email', 'firstName')
   *
   * Use this for field identification in stores, APIs, and data structures.
   */
  id: FieldId

  /**
   * Composite identifier scoped to entity definition.
   * Format: `${entityDefinitionId}:${fieldId}`
   *
   * Uniquely identifies this field across the entire system.
   * Useful for global field lookups and caching.
   *
   * @optional - Can be computed via toResourceFieldId(entityDefinitionId, field.id)
   */
  resourceFieldId?: ResourceFieldId

  /** Field identifier for variable paths (e.g., 'title', 'status', 'Colors1') */
  key: string
  /** Display label for UI */
  label: string
  /** Field data type (for workflow engine: 'string', 'number', 'object', 'array', etc.) */
  type: BaseType

  /**
   * Original FieldType from CustomField (e.g., 'TEXT', 'RELATIONSHIP', 'EMAIL')
   * Used for determining value storage type (which columns store the value).
   * Different from type: type is for workflow engine (BaseType),
   * fieldType is for storage and value extraction (FieldType enum).
   * @optional - populated for custom entity fields, undefined for system resource fields
   */
  fieldType?: FieldType

  // Database properties
  /** Database column name (if different from key) */
  dbColumn?: string
  /** Database type (e.g., 'varchar', 'text', 'timestamp') */
  dbType?: string
  /** Whether field allows NULL values in database */
  nullable?: boolean

  // Field options (display options, currency config, etc.)
  /** Field options from CustomField.options - contains display options (checkboxStyle, decimals, format, etc.) */
  options?: FieldOptions

  // Capabilities (what can be done with this field)
  capabilities: FieldCapabilities

  // Operator configuration
  /**
   * Optional: Override default operators for this field.
   * If not provided, operators are derived from field.type using TYPE_OPERATOR_MAP.
   *
   * Use this ONLY when:
   * 1. You want to RESTRICT operators (e.g., ID field should only allow 'is', 'is not')
   * 2. You want to ADD custom operators (e.g., special business logic operators)
   *
   * Examples:
   * - ID field: operatorOverrides: ['is', 'is not'] (restrict from default STRING operators)
   * - Status field: operatorOverrides: ['is', 'is not', 'in', 'not in'] (already default for ENUM, so not needed)
   */
  operatorOverrides?: string[]

  // UI hints
  /** Icon name for UI display (optional - defaults based on fieldType) */
  icon?: string
  /** Placeholder text for input fields */
  placeholder?: string
  /** Field description for help text */
  description?: string

  // Validation rules
  validation?: FieldValidation

  // Relationship configuration (REQUIRED for RELATION type)
  /** Relationship configuration for RELATION type fields - matches database schema */
  relationship?: FieldOptions['relationship']

  /**
   * Relationship field configuration for EntitySeeder
   * Used to create relationship field pairs (primary + inverse) during seeding.
   * Only needed for system relationship fields that need to be seeded.
   */
  relationshipConfig?: {
    /** Target entity type (e.g., 'contact', 'user', 'ticket') */
    relatedEntityType: string
    /** Relationship type ('belongs_to', 'has_many', 'has_one') */
    relationshipType: 'belongs_to' | 'has_many' | 'has_one'
    /** Display name for the inverse field (e.g., 'Tickets', 'Assigned Tickets') */
    inverseName: string
    /** System attribute for the inverse field (e.g., 'contact_tickets', 'user_assigned_tickets') */
    inverseSystemAttribute: SystemAttribute
  }

  // Default value configuration
  /**
   * Default value to use when resource type changes.
   * Applies in both create and update modes.
   * For ENUM types, should be one of the options value strings.
   * For other types, should match the field type (string, number, boolean, etc.).
   * Users can clear this value if the field is optional.
   * @optional
   */
  defaultValue?: unknown

  // Import identifier configuration
  /**
   * Whether this field can be used to identify/match existing records during import.
   * When true, the field can be selected as the identifier field for update strategy.
   * Typically used for unique fields like email, phone, or record numbers.
   * @optional
   */
  isIdentifier?: boolean

  /**
   * This field's 1-based position in the resource's NATURAL KEY — the tuple of
   * fields that together identify a record when no single field can.
   *
   * `vendor_part` is the motivating case: its identity is `(part, supplier)`,
   * two relations, neither unique on its own and neither ever a sensible lone
   * match key. Without the declaration a supplier price list can only ever be
   * re-imported as duplicates, because the picker offers nothing above "Record
   * ID" and no CSV carries cuids.
   *
   * Declared on the FIELD, and promoted through `mergeSystemAndCustomFields`'
   * allow-list exactly as {@link ResourceField.isIdentifier} is. Whether
   * `(part, supplier)` identifies a supplier price line is a product fact, so it
   * belongs to the registry — deriving it from a per-org DB column is the drift
   * mistake that left `part_sku.isUnique = false` in half the fleet for four
   * months.
   *
   * The position is what makes the key ORDERED and therefore stable: the
   * importer ANDs the legs in declaration order, and the preview names them in
   * that order. Positions must be contiguous from 1 within one resource; a test
   * pins that.
   *
   * @optional
   */
  naturalKeyPosition?: number

  /**
   * Declares a NAMED IMPORTER for this relation's target — an extra entry in the
   * host resource's Import menu that starts a job against the entity on the far
   * side of this field.
   *
   * `part.vendorParts` declares *"Import supplier prices"*, so a supplier price
   * list can be imported even though `vendor_part` is hidden and therefore has no
   * records page of its own to host the usual button. Hidden has always meant *no
   * sidebar entry, no records page* — never *not importable* — and this is the
   * door that says so out loud.
   *
   * Declared on the RELATION FIELD rather than on the resource, for two reasons.
   * The field already knows the target: it is `relationship.inverseResourceFieldId`,
   * so nothing has to restate a def id that could drift. And table-level config is
   * dead for exactly the resources that need this — `RESOURCE_TABLE_REGISTRY`
   * excludes every `ENTITY_DEFINITION_TYPES` member (`field-registry.ts`), `part`
   * included, which is the same trap that put {@link ResourceField.naturalKeyPosition}
   * on the field.
   *
   * Registry-only, promoted through `mergeSystemAndCustomFields`' allow-list with
   * no DB fallback: whether a file of supplier prices is a thing users import is a
   * product fact, not per-org state.
   *
   * ⚠️ Declaring one is what EXPOSES the importer. `part.usedInAssemblies` is
   * deliberately silent — it is the same BOM edge as `subparts` read backwards, and
   * offering both lets one file assert an edge twice in opposite senses, which the
   * `(parentPart, childPart)` key then collapses to whichever row landed last.
   *
   * @optional
   */
  namedImporter?: {
    /** Menu label, e.g. `'Import supplier prices'`. Imperative, not a noun. */
    label: string
  }

  // ─────────────────────────────────────────────────────────────
  // CONVENIENCE PROPERTIES (for unified consumption, avoid transforms)
  // ─────────────────────────────────────────────────────────────

  /** Human-readable name (alias for 'label' for consumer compatibility) */
  name?: string

  /** Explicit sort order for field lists (lexicographic string for fractional indexing) */
  sortOrder?: string

  /** Whether field is currently active/visible (default: true) */
  active?: boolean

  /** Whether field must contain unique values (convenience for capabilities.unique) */
  isUnique?: boolean

  /** Whether field is required (convenience for capabilities.required) */
  required?: boolean

  // ─────────────────────────────────────────────────────────────
  // SYSTEM FIELD PROPERTIES (for unified field handling)
  // ─────────────────────────────────────────────────────────────

  /**
   * True for system/built-in fields that exist on the database table.
   * False or undefined for custom fields defined via CustomField entity.
   */
  isSystem?: boolean

  /**
   * Key for dynamic options loading. Maps to DYNAMIC_OPTIONS_REGISTRY.
   * Example: 'contactGroups' loads customer groups via tRPC
   */
  dynamicOptionsKey?: string

  /**
   * For computed/display fields: source fields to combine.
   * Example: name field with sourceFields: ['firstName', 'lastName']
   * Used for hydration to build composite value object.
   */
  sourceFields?: string[]

  /**
   * For computed fields: target fields to update when saving.
   * Example: name field with targetFields: ['firstName', 'lastName']
   * The input component must handle splitting the value.
   */
  targetFields?: string[]

  /**
   * Sort order within system fields (fractional indexing string).
   * Uses format: 'a0', 'a1', ..., 'a9', 'aA', ..., 'aZ', 'aa', ..., 'az'
   * Custom fields use their own sortOrder from CustomField entity.
   */
  systemSortOrder?: string

  /**
   * Whether to show this field in the property panel.
   * Default: true. Set to false for relationship reverse-fields, internal fields, etc.
   */
  showInPanel?: boolean

  /**
   * Whether to show this field as a column in the default (list) table view.
   * When unset, the table default resolves to `showInPanel !== false` — i.e. the
   * table mirrors the panel default. Set this explicitly only when the table
   * default must diverge from the panel: e.g. a long-form description shown in
   * the panel but hidden from the table (`showInPanel` unset/true, `showInTable:
   * false`), or a computed column hidden from the panel but useful as a table
   * column (`showInPanel: false`, `showInTable: true`). Read live by the table's
   * `defaultVisible` — no per-org materialization.
   */
  showInTable?: boolean

  /**
   * When false, the field is hidden from the default create/update dialogs
   * unless an org view explicitly enables it. Defaults to true.
   */
  showInDialogs?: boolean

  /**
   * Declared `identity: true` in a connector's `defineFields` — an
   * external-system id (e.g. Shopify `customerId`), not a plain attribute.
   * Mirrors `CustomField.isIdentity`. Like `showInDialogs === false`, this
   * defaults the field to hidden in create/update dialogs (see
   * use-field-view.ts) unless an org view explicitly enables it.
   */
  isIdentity?: boolean

  /**
   * System attribute identifier
   * - If set: System field (cannot delete/edit, special rendering)
   * - If null/undefined: Custom field (can delete/edit, generic rendering)
   *
   * Examples: 'primary_email', 'first_name', 'ticket_number'
   *
   * This is used by:
   * - EntitySeeder to create CustomField records
   * - Frontend to determine if field is editable
   * - Validation hooks to apply special behavior
   *
   * NOTE: isSystem can be derived: isSystem = !!systemAttribute
   */
  systemAttribute?: SystemAttribute

  /**
   * True for app-registered custom fields (owned by an installed app).
   * App-owned fields are user-read-only at the definition level and removed on
   * uninstall. Derivable from `appInstallationId`. See app-registered custom
   * fields.
   */
  isAppOwned?: boolean

  /**
   * Owning app installation id for app-registered fields (undefined for
   * user/system fields). Lets consumers (e.g. the v5 chat fence) scope to the
   * fields a given installation owns.
   */
  appInstallationId?: string

  /**
   * Stable per-app field key for app-registered fields (undefined for
   * user/system fields). Combined with the app slug, this builds the
   * connection-late-bound `@app:<slug>:<key>` var ref.
   */
  appFieldKey?: string

  /**
   * Owning DataConnector that provisioned this field (owned-mode only). When
   * set, the field's values are managed by a data connector and the column is
   * read-only (provisioning already sets `isUpdatable=false`). Surfaced so the
   * UI can render a "Managed by <connector>" lock badge — distinct from
   * system/app/computed ownership. Undefined for user/system/app fields.
   */
  dataConnectorId?: string
}

/**
 * Why a field is locked / who owns it. Read from the ownership signals rather
 * than inferred from `isUpdatable` (which is overloaded across system/computed/
 * app/connector fields). Connector is checked first so a connector-provisioned
 * field never mis-labels as "system".
 */
export type FieldLockReason = 'computed' | 'connector' | 'system' | 'app' | 'none'

/**
 * Resolve a field's lock reason from its ownership signals. Pure + client-safe
 * — used by the UI lock badge and any edit-gate messaging. Takes the ownership
 * subset of a `ResourceField`.
 */
export function fieldLockReason(
  field: Pick<ResourceField, 'dataConnectorId' | 'systemAttribute' | 'appInstallationId'> & {
    isComputed?: boolean
  }
): FieldLockReason {
  if (field.dataConnectorId) return 'connector'
  if (field.isComputed) return 'computed'
  if (field.systemAttribute) return 'system'
  if (field.appInstallationId) return 'app'
  return 'none'
}

/**
 * Get the stable output key for a field.
 *
 * For entity-definition system fields (tag, contact, ticket, etc.), the field's `key`
 * after plan 09 is the display name (e.g., "Parent Tag"). The stable identifier is
 * stored in `systemAttribute` (e.g., "tag_parent").
 *
 * For system resources (thread, message, etc.), `mergeSystemAndCustomFields` already
 * overrides `key` with the static field key, so `systemAttribute` and `key` are
 * effectively equivalent — this helper is a no-op.
 *
 * For custom fields, `systemAttribute` is undefined, so this falls back to `key`.
 */
export function getFieldOutputKey(field: Pick<ResourceField, 'key' | 'systemAttribute'>): string {
  return field.systemAttribute ?? field.key
}

/**
 * Resource field registry type
 * Maps resource types to their field definitions
 */
export type ResourceFieldRegistry = Record<string, Record<string, ResourceField>>
