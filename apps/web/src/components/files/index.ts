// apps/web/src/components/files/index.ts

export { getFileCategory, getStandardFileType } from '@auxx/utils/file'
export { CreateFolderDialog } from './create-folder-dialog'
// Table columns
export { createFileColumns } from './file-columns'
export { FileDetailDrawer } from './file-detail-drawer'
export { FileDropZone } from './file-drop-zone'
export { FileFilterBar } from './file-filter-bar'
export { FileUploadDialog } from './file-upload-dialog'
export { FilesBreadcrumb } from './files-breadcrumb'
// Main components
export { FilesManagement } from './files-management'
// Types
export type {
  BreadcrumbItem,
  FileFilterSettings,
  FileItem,
  FileSystemStore,
  FolderTreeNode,
} from './files-store'
// Store
export { useFileSystemStore } from './files-store'
// Hook
export { useFilesystem } from './hooks/use-filesystem'
// Provider and context
export { FilesystemProvider, useFilesystemContext } from './provider/filesystem-provider'
// Utils
export { getFileIcon } from './utils/file-icon'
