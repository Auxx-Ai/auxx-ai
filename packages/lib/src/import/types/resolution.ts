// packages/lib/src/import/types/resolution.ts

import type { SelectOption } from '@auxx/types/custom-field'
import type { IdentityRole, ImportMergeStrategy } from '../../write-policy'

/** All supported resolution types */
export type ResolutionType =
  | 'text:value' // Plain text
  | 'text:cuid' // Parse as cuid2 ID (for matching existing records)
  | 'number:integer' // Parse integer
  | 'number:decimal' // Parse decimal
  | 'currency:major' // Money as humans write it ("12.34") → integer minor units
  | 'date:iso' // ISO date
  | 'date:custom' // Custom date format
  | 'datetime:iso' // ISO datetime
  | 'datetime:custom' // Custom datetime format
  | 'boolean:truthy' // Boolean parsing
  | 'email:value' // Email validation
  | 'email:split' // Split comma/semicolon cell into validated emails (multi fields)
  | 'phone:value' // Phone normalization
  | 'phone:split' // Split cell into normalized phones (multi fields)
  | 'url:split' // Split cell into normalized URLs (multi fields)
  | 'select:value' // Match enum option
  | 'select:create' // Match or create enum
  | 'multiselect:split' // Split and match
  | 'relation:id' // CSV contains the target record's ID directly
  | 'relation:match' // Match related record by a field value (e.g., name, email)
  | 'relation:create' // Match or create related record if not found
  | 'domain:value' // Parse domain
  | 'url:value' // URL validation (scheme/path preserved — write-path normalized)
  | 'array:split' // Split to array

/** Configuration for resolution */
export interface ResolutionConfig {
  dateFormat?: string
  timestampFormat?: string
  numberDecimalSeparator?: string
  arraySeparator?: string

  /**
   * ISO 4217 code of the TARGET CURRENCY field, resolved through the
   * `field → org → USD` chain (`resolveCurrencyCode` / `getOrgCurrencyCode`).
   *
   * Read by `currency:major` to pick the minor-unit exponent — 2 for USD/EUR,
   * 0 for JPY, 3 for KWD. Never hardcode 100.
   *
   * 🛑 NOT persisted by `saveMappingProperty`, and it must stay that way. A
   * field with no `options.currencyCode` INHERITS `organization.currency`, so a
   * copy frozen into the column's stored config at mapping time would keep
   * scaling by the old exponent after the org changed its setting. It is
   * resolved fresh each run, in `resolve-values-job`.
   */
  currencyCode?: string
  options?: SelectOption[]

  /**
   * The identity role this COLUMN plays, the source of truth behind
   * `ImportMapping.identifierFieldKeys`.
   *
   * `{ kind: 'match' }` on one column is the ordinary single identifier; on two
   * columns it is the composite `(part, supplier)` key, with no new concepts.
   * Absent = the column is data only.
   *
   * Deliberately taken WITHOUT the connector's `normalize` knob. The importer
   * already has two normalization authorities that must agree,
   * `normalizeForLookup` (automatic, type-driven) and `checkUniqueValueTyped`
   * (bare `eq`), and a user-settable third is the only one a human can desync
   * by hand. Never persist `normalize` here.
   */
  identityRole?: IdentityRole

  /**
   * Per-column write policy on the UPDATE path. Absent ⇒ `'overwrite'`.
   *
   * - `overwrite` , the file wins, INCLUDING blanks. This is the opt-in that
   *                  makes explicit clearing reachable at all.
   * - `fill_blank`, write only when the stored value is empty ("don't clobber
   *                  what a human set").
   * - `ignore`    , map this column for the CREATE path only.
   *
   * `fill_blank` asks whether the TARGET is empty. The separate
   * blank-source rule (a blank cell is an ABSENCE on update, never a value)
   * asks whether the SOURCE is empty. They compose; they are not one switch.
   */
  mergeStrategy?: ImportMergeStrategy

  /** Relation resolution config (from ResourceRegistryService) */
  relationConfig?: {
    relatedEntityDefinitionId: string // e.g., 'contact', 'ticket', or custom UUID
    matchField?: string // Field to match on (defaults to primaryDisplayField)
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    /**
     * What happens when the cell names a target record that does not exist.
     * Defaults to `'create'` when `matchField` IS the target's primary display
     * field, and `'fail'` otherwise, creating a company from a match on VAT
     * number produces a company whose NAME is a VAT number.
     */
    onNoMatch?: RelationOnNoMatch
    /**
     * For a `has_many` / `many_to_many` target on the UPDATE path: does the
     * file's value replace the existing links or append to them? Defaults to
     * `'add'`, a CSV column carrying one supplier is not a statement that the
     * part has only that supplier.
     */
    linkMode?: RelationLinkMode
  }
}

/**
 * What happens when a relation cell names a target record that does not exist.
 *
 * - `create`, mint the target record carrying the match value
 * - `blank` , the row imports with no link (recoverable, but silent: it is
 *              counted for the preview so it is never a surprise)
 * - `fail`  , the whole row is skipped (the only behaviour before this policy
 *              existed, which is why a parts file naming new suppliers failed
 *              100% of its rows)
 */
export type RelationOnNoMatch = 'create' | 'blank' | 'fail'

/**
 * Replace-or-append for a multi-valued relation on the UPDATE path.
 *
 * Distinct from the data-connector `FieldMapping.linkMode`
 * (`'upsert' | 'reference'`), which answers "write the target record or
 * register a pending reference on the parent". Same word, different axis; they
 * never appear on the same object.
 */
export type RelationLinkMode = 'add' | 'set'

/** What `materializeRelationCreates` must mint for a `type: 'create'` value */
export interface RelationCreateRequest {
  /** Target entity definition (the org's EntityDefinition id or its slug) */
  entityDefinitionId: string
  /** Field key the value is matched on, always the target's display field */
  matchField: string
  /** Raw cell value, minted onto `matchField` */
  value: string
}

/** Result of resolving a value */
export interface ResolvedValue {
  type: 'value' | 'error' | 'warning' | 'create'
  value?: unknown
  error?: string
  warning?: string
  /**
   * Present only on relation `type: 'create'` values. Carries what
   * `materializeRelationCreates` needs to mint the target at EXECUTION time,
   * creation deliberately does not happen while the plan is being generated,
   * so abandoning the wizard at the preview leaves no orphan records behind.
   *
   * `value` stays `null` until materialization rewrites this entry to
   * `{ type: 'value', value: <recordId> }`. Null is the safe unmaterialized
   * shape: the row imports with no link rather than with a garbage one.
   */
  relationCreate?: RelationCreateRequest
}

/** Resolution result for a single raw value */
export interface ResolutionResult {
  rawValue: string
  hashedValue: string
  resolvedValues: ResolvedValue[]
  isValid: boolean
  error?: string
}

/** Cached value resolution record */
export interface ValueResolution {
  id: string
  importJobPropertyId: string
  hashedValue: string
  rawValue: string
  cellCount: number
  resolvedValues: ResolvedValue[]
  isValid: boolean
  errorMessage?: string
}

/** Unique value with occurrence count */
export interface UniqueValue {
  rawValue: string
  hash: string
  count: number
}

/** Override value for user corrections */
export interface OverrideValue {
  type: 'value' | 'create' | 'skip'
  value: string
  id?: string // For relationships - the resolved entity ID
}

/** Field configuration for value editing */
export interface ColumnFieldConfig {
  key: string
  type: string // BaseType: 'text', 'number', 'enum', 'relationship', etc.
  resolutionType: string // e.g., 'select:value', 'relation:match'
  options?: SelectOption[]
  relationConfig?: {
    relatedEntityDefinitionId: string
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  }
}
