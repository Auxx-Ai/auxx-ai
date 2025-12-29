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
  sourceColumnIndex: number
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
