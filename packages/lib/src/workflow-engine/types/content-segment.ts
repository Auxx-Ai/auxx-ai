// packages/lib/src/workflow-engine/types/content-segment.ts

import type { WorkflowFileData } from './file-variable'

/**
 * Text content segment - plain text
 */
export interface TextContentSegment {
  type: 'text'
  value: string
}

/**
 * File content segment - single file with URL and metadata
 */
export interface FileContentSegment {
  type: 'file'
  value: WorkflowFileData
}

/**
 * File array content segment - multiple files
 */
export interface FileArrayContentSegment {
  type: 'file-array'
  value: WorkflowFileData[]
}

/**
 * Union of all content segment types
 * Used for rendering rich content in end node output
 */
export type ContentSegment = TextContentSegment | FileContentSegment | FileArrayContentSegment

/**
 * Type guard to check if a value is WorkflowFileData
 * Checks for required file properties
 */
export function isWorkflowFileData(value: unknown): value is WorkflowFileData {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.filename === 'string' &&
    typeof obj.mimeType === 'string' &&
    typeof obj.size === 'number' &&
    typeof obj.url === 'string'
  )
}

/**
 * Type guard to check if a value is an array of WorkflowFileData
 */
export function isWorkflowFileDataArray(value: unknown): value is WorkflowFileData[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return false
  return value.every(isWorkflowFileData)
}

/**
 * Type guard to check if a value is a file variable wrapper
 * File variables created by createFileVariable() have type: 'file' and example: WorkflowFileData
 */
export function isFileVariableWrapper(
  value: unknown
): value is { type: 'file'; example: WorkflowFileData } {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return obj.type === 'file' && isWorkflowFileData(obj.example)
}

/**
 * Type guard to check if a value is a file array variable wrapper
 */
export function isFileArrayVariableWrapper(
  value: unknown
): value is { type: 'array'; example: WorkflowFileData[] } {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return obj.type === 'array' && isWorkflowFileDataArray(obj.example)
}

/**
 * Extract WorkflowFileData from a value that could be:
 * - Direct WorkflowFileData
 * - File variable wrapper (with example property)
 */
export function extractFileData(value: unknown): WorkflowFileData | WorkflowFileData[] | null {
  // Direct WorkflowFileData
  if (isWorkflowFileData(value)) {
    return value
  }

  // Direct array of WorkflowFileData
  if (isWorkflowFileDataArray(value)) {
    return value
  }

  // File variable wrapper
  if (isFileVariableWrapper(value)) {
    return value.example
  }

  // File array variable wrapper
  if (isFileArrayVariableWrapper(value)) {
    return value.example
  }

  return null
}
