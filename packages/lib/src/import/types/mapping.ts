// packages/lib/src/import/types/mapping.ts

import type { IdentityRole, ImportMergeStrategy } from '../../write-policy'
import type { RelationLinkMode, RelationOnNoMatch, ResolutionType } from './resolution'

/**
 * What an import does with a row once the identifier has (or has not) matched.
 *
 * | Mode               | Matched row | Unmatched row              |
 * | ------------------ | ----------- | -------------------------- |
 * | `create`           | create a second record | create          |
 * | `update`           | update      | skip, reported as UNMATCHED |
 * | `create-or-update` | update      | create                      |
 *
 * `create-or-update` is the default once an identifier column is chosen, it is
 * what "import my supplier's monthly price list" means, and the only mode where
 * running the same file twice is a no-op.
 *
 * The old `'skip'` member is retired. `skip` is a per-ROW strategy
 * ({@link StrategyType}), never a job-level mode; a job whose mode was `skip`
 * would import nothing at all.
 */
export type ImportStrategyMode = 'create' | 'update' | 'create-or-update'

/** Reusable import mapping template */
export interface ImportMapping {
  id: string
  organizationId: string
  targetTable: string
  entityDefinitionId?: string
  title: string
  sourceType: 'csv'
  defaultStrategy: ImportStrategyMode
  /**
   * Ordered field keys forming the match key. Empty when no identifier is
   * chosen (⇒ create-only, whatever the mode says). More than one key is a
   * COMPOSITE key, ANDed. Derived from the per-column
   * `resolutionConfig.identityRole` markers, see `deriveIdentifierFieldKeys`.
   */
  identifierFieldKeys: string[]
  createdById?: string
  createdAt: Date
  updatedAt: Date
}

/** Column mapping within a template */
export interface ImportMappingProperty {
  id: string
  importMappingId: string
  /**
   * Zero-based source column index for the CSV importer (rowData keyed by
   * number). Kept as the primary CSV identifier.
   */
  sourceColumnIndex: number
  /**
   * String source-field key for non-CSV sources (e.g. data connectors, where
   * a record is keyed by field path rather than column index). Additive and
   * optional — when set, the source-value accessor reads `rowData[sourceFieldKey]`
   * instead of `rowData[sourceColumnIndex]`. Leave undefined for CSV imports.
   */
  sourceFieldKey?: string
  sourceColumnName?: string
  targetType: 'particle' | 'relation' | 'skip'
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: ResolutionType
  resolutionConfig?: string // JSON string with config options
  /** Parsed resolution config */
  dateFormat?: string
  numberDecimalSeparator?: string
  arraySeparator?: string
  createdAt: Date
  updatedAt: Date
}

/** Job-specific property instance */
export interface ImportJobProperty {
  id: string
  importJobId: string
  importMappingPropertyId: string
  uniqueValueCount: number
  resolvedCount: number
  errorCount: number
}

/** Field mapping for UI display */
export interface ColumnMapping {
  columnIndex: number
  columnName: string
  targetFieldKey: string | null
  targetFieldLabel: string | null
  resolutionType: ResolutionType
  sampleValues: string[]
  isMapped: boolean
  hasErrors: boolean
}

/**
 * One CSV column as the mapping step sees it: the header, a few sample values,
 * whatever mapping is saved against it, and the per-file uniqueness signal.
 *
 * Lives here rather than beside its query so the wizard can import the shape
 * from `@auxx/lib/import/client`, `get-mappable-properties.ts` pulls in Drizzle
 * and cannot be re-exported from the client barrel.
 */
export interface MappablePropertyWithSamples {
  id: string
  columnIndex: number
  visibleName: string
  sampleValues: string[]
  targetType: string
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  matchField: string | null
  /**
   * The identity flag on this column. `{ kind: 'match' }` ⇒ it is (part of) the job's
   * match key. Derived per-job into `ImportMapping.identifierFieldKeys`.
   */
  identityRole: IdentityRole | null
  /** Per-column write policy on the update path. Absent ⇒ `'overwrite'`. */
  mergeStrategy: ImportMergeStrategy | null
  /**
   * The relation column's no-match policy, read straight off the same parsed
   * `resolutionConfig` as `matchField`.
   *
   * `saveMappingProperty` REBUILDS `relationConfig` from its input rather than
   * merging it, so the wizard has to resend the whole policy on every write —
   * which means it has to know the stored policy on load. It rides this read
   * because the row is already fetched and already parsed here.
   */
  onNoMatch: RelationOnNoMatch | null
  /** Replace-or-append for a multi-valued relation on the update path. */
  linkMode: RelationLinkMode | null
  /**
   * Distinct raw values in THIS column of THIS file.
   *
   * Field-level `isUnique` answers the wrong question, it is a claim about the
   * database, not about the upload. The question that decides whether a column
   * can key an import is *"can this column identify a row in this file?"*, and
   * `distinctValueCount < totalValueCount` on the identifier column is the failure
   * `isUnique` cannot see: values duplicated inside the upload quietly create
   * two records that no later import can ever match again.
   */
  distinctValueCount: number
  /** Total cells stored for this column (blank cells included). */
  totalValueCount: number
}
