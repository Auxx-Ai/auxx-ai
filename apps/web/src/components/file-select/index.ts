// apps/web/src/components/file-select/index.ts

/**
 * Barrel exports for FileSelect component system
 */

// Main component
export { FileSelect } from './file-select'

// Sub-components
export { FileSelectDialog } from './file-select-dialog'

// Hooks
export { useFileSelect } from './hooks/use-file-select'

// Types
export type {
  FileSelectItem,
  FileSelectProps,
  FileSelectState,
  FileSelectActions,
  UseFileSelectOptions,
  UseFileSelectReturn,
} from './types'
