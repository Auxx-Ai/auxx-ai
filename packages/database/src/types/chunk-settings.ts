// packages/database/src/types/chunk-settings.ts

import type { ChunkingStrategy } from '../types'

/**
 * Preprocessing options for document content before chunking
 */
export interface ChunkPreprocessingOptions {
  /** Replace consecutive spaces, newlines, and tabs with single characters */
  normalizeWhitespace: boolean
  /** Remove all URLs and email addresses from content */
  removeUrlsAndEmails: boolean
}

/**
 * Configuration for text chunking strategy and parameters
 */
export interface ChunkSettings {
  /** Chunking algorithm to use */
  strategy: ChunkingStrategy
  /** Target chunk size in characters (100-5000) */
  size: number
  /** Overlap between adjacent chunks in characters (0-1000) */
  overlap: number
  /** Optional custom delimiter for splitting text */
  delimiter?: string | null
  /** Content preprocessing options */
  preprocessing: ChunkPreprocessingOptions
}

/**
 * Default chunk settings
 */
export const DEFAULT_CHUNK_SETTINGS: ChunkSettings = {
  strategy: 'FIXED_SIZE',
  size: 1000,
  overlap: 200,
  delimiter: '\n\n',
  preprocessing: {
    normalizeWhitespace: true,
    removeUrlsAndEmails: false,
  },
}
