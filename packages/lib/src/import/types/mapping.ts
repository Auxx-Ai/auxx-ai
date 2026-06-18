// packages/lib/src/import/types/mapping.ts

import type { ResolutionType } from './resolution'

/** Reusable import mapping template */
export interface ImportMapping {
  id: string
  organizationId: string
  targetTable: string
  entityDefinitionId?: string
  title: string
  sourceType: 'csv'
  defaultStrategy: 'create' | 'update' | 'skip'
  identifierFieldKey?: string
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
