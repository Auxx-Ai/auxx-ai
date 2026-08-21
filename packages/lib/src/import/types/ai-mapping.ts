// packages/lib/src/import/types/ai-mapping.ts

import type { RelationLinkMode, RelationOnNoMatch } from './resolution'

/** Input for AI column mapping */
export interface AIColumnMappingInput {
  columns: Array<{
    index: number
    name: string
    sampleValues: string[]
  }>
  targetFields: Array<{
    key: string
    label: string
    type: string
    required: boolean
    isRelation: boolean
    options?: Array<{ value: string; label: string }>
    /**
     * Present on relation fields. Auto-map needs it to resolve the target's
     * display field into an explicit `matchField`, the second half of the
     * Defect E fix. Callers pass `ImportableField[]`, which carries it.
     */
    relationConfig?: {
      relatedEntityDefinitionId: string
      relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    }
  }>
  entityDefinitionId: string // For context (e.g., "contact", "ticket")
}

/** Single column mapping result from AI */
export interface AIColumnMappingResult {
  columnIndex: number
  columnName: string
  matchedFieldKey: string | null
  resolutionType: string
  confidence: number
  reasoning?: string // Optional explanation from AI

  // ── Relation policy (both auto-map arms) ──────────────────────────────────
  // Auto-map is the ONLY producer of a relation mapping with no match field
  //the picker's drill-down cannot commit without one, and that state is
  // exactly what made every auto-mapped relation column report "No match found"
  // for every value (03 §2.1). These carry the explicit policy through to
  // `batchUpdateMappingsFromAutoMap`, which persists it into `relationConfig`.
  // Absent on scalar columns.
  /** Target field to match on. Always set for a relation column. */
  matchField?: string
  relatedEntityDefinitionId?: string
  relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  onNoMatch?: RelationOnNoMatch
  linkMode?: RelationLinkMode
}

/** Complete AI mapping response */
export interface AIColumnMappingResponse {
  mappings: AIColumnMappingResult[]
  usedAI: boolean
  model?: string
  tokensUsed?: number
}
