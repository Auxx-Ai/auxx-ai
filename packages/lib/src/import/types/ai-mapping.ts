// packages/lib/src/import/types/ai-mapping.ts

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
}

/** Complete AI mapping response */
export interface AIColumnMappingResponse {
  mappings: AIColumnMappingResult[]
  usedAI: boolean
  model?: string
  tokensUsed?: number
}
