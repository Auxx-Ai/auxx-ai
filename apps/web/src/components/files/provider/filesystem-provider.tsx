// apps/web/src/components/files/provider/filesystem-provider.tsx

'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useFilesystem } from '../hooks/use-filesystem'

/**
 * Type for the filesystem context value
 */
type FilesystemContextType = ReturnType<typeof useFilesystem>

/**
 * React context for filesystem state and actions
 */
const FilesystemContext = createContext<FilesystemContextType | null>(null)

/**
 * Props for the FilesystemProvider component
 */
interface FilesystemProviderProps {
  children: ReactNode
}

/**
 * Provider component for filesystem context
 * Wraps the useFilesystem hook and provides its state/actions to child components
 */
export function FilesystemProvider({ children }: FilesystemProviderProps) {
  // const storeRef = useRef<StoreApi<FileSystemState>>()

  const filesystem = useFilesystem()

  return <FilesystemContext.Provider value={filesystem}>{children}</FilesystemContext.Provider>
}

/**
 * Hook to access filesystem context
 * Must be used within a FilesystemProvider
 *
 * @throws Error if used outside of FilesystemProvider
 * @returns Filesystem state and actions
 */
export function useFilesystemContext() {
  const context = useContext(FilesystemContext)
  if (!context) {
    throw new Error('useFilesystemContext must be used within a FilesystemProvider')
  }
  return context
}
