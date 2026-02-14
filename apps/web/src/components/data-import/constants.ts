// apps/web/src/components/data-import/constants.ts

import { GitBranch, Play, Search, Upload } from 'lucide-react'
import type { ImportStep } from './types'

/** Maximum file size: 20MB */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

/** Maximum rows per upload chunk */
export const UPLOAD_CHUNK_SIZE = 1000

/** Step configuration for Stepper */
export const IMPORT_STEP_CONFIG: Record<
  ImportStep,
  {
    title: string
    icon: typeof Upload
    color: string
    activeColor: string
    completeColor: string
  }
> = {
  upload: {
    title: 'Upload File',
    icon: Upload,
    color: 'text-muted-foreground',
    activeColor: 'text-blue-500',
    completeColor: 'text-green-500',
  },
  'map-columns': {
    title: 'Map Columns',
    icon: GitBranch,
    color: 'text-muted-foreground',
    activeColor: 'text-blue-500',
    completeColor: 'text-green-500',
  },
  'review-values': {
    title: 'Review Values',
    icon: Search,
    color: 'text-muted-foreground',
    activeColor: 'text-blue-500',
    completeColor: 'text-green-500',
  },
  confirm: {
    title: 'Import',
    icon: Play,
    color: 'text-muted-foreground',
    activeColor: 'text-blue-500',
    completeColor: 'text-green-500',
  },
}

/** Ordered step sequence */
export const IMPORT_STEPS: ImportStep[] = ['upload', 'map-columns', 'review-values', 'confirm']

/** File size thresholds for upload strategy */
export const FILE_SIZE_THRESHOLDS = {
  SINGLE_REQUEST: 2 * 1024 * 1024, // < 2MB: single request
  CHUNKED: 20 * 1024 * 1024, // 2-20MB: chunked
  REJECTED: 20 * 1024 * 1024, // > 20MB: reject
} as const
