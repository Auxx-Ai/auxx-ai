// apps/web/src/components/files/index.ts

// Main components
export { FilesManagement } from './files-management'
export { FilesBreadcrumb } from './files-breadcrumb'
export { FileDropZone } from './file-drop-zone'
export { FileDetailDrawer } from './file-detail-drawer'
export { FileUploadDialog } from './file-upload-dialog'
export { CreateFolderDialog } from './create-folder-dialog'
export { FileFilterBar } from './file-filter-bar'

// Provider and context
export { FilesystemProvider, useFilesystemContext } from './provider/filesystem-provider'

// Hook
export { useFilesystem } from './hooks/use-filesystem'

// Store
export { useFileSystemStore } from './files-store'

// Table columns
export { createFileColumns } from './file-columns'

// Utils
export { getFileIcon } from './utils/file-icon'
export { getStandardFileType, getFileCategory } from './utils/file-type'

// Types
export type { 
  FileItem, 
  FileSystemStore, 
  FolderTreeNode, 
  BreadcrumbItem,
  FileFilterSettings 
} from './files-store'