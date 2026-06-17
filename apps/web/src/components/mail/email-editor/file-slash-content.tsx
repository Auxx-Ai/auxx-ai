// apps/web/src/components/mail/email-editor/file-slash-content.tsx
'use client'

import { CommandNavigation, useCommandNavigation } from '@auxx/ui/components/command'
import { useCallback, useImperativeHandle, useRef } from 'react'
import type { SlashContentHandle } from '~/components/editor/slash-commands/slash-list'
import type { FileItem } from '~/components/files/files-store'
import { FileBrowseLevel, type FileNavigationItem } from '~/components/pickers/file-browse-level'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'

export interface FileSlashContentProps {
  /** Keyboard handle — the `/` chip forwards Enter / arrows / Backspace-empty here. */
  ref?: React.Ref<SlashContentHandle>
  /** Live filter — the `/` chip's text content (drives the focusless browse). */
  query: string
  /** Attach the chosen library file into the composer's attachment tray. */
  onAttachFile: (file: FileItem) => void
  /**
   * Upload fresh files from the user's computer into the composer's attachment
   * tray. When provided, an "Upload from computer" row is pinned to the top of
   * the list. Wired to the composer-level `fileSelect.addFiles`, so the upload
   * survives the chip closing when the native dialog steals focus.
   */
  onUploadFiles?: (files: File[]) => void
  /** Close the chip (keeps the typed text, mirroring `@`). */
  onClose: () => void
  /** Return to the parent `/` command menu. */
  onBack: () => void
  /** Label for the browse-root back affordance. Defaults to 'Commands'. */
  backLabel?: string
}

/**
 * Chip-driven file attachment picker — the shared {@link FileBrowseLevel} run in
 * focusless `remote` mode, wrapped as `SlashContentProps`. The `/` chip keeps
 * editor focus and owns the query; `useCmdkRemote` drives highlight / confirm /
 * drill via pointer events (no `CommandInput`). Selecting a file hands it to the
 * composer's `onAttachFile` and closes the chip — the transient slash popover
 * owns no tray of its own (the composer's `useFileSelect` does).
 */
export function FileSlashContent(props: FileSlashContentProps) {
  return (
    <CommandNavigation<FileNavigationItem>>
      <FileSlashInner {...props} />
    </CommandNavigation>
  )
}

function FileSlashInner({
  ref,
  query,
  onAttachFile,
  onUploadFiles,
  onClose,
  onBack,
  backLabel,
}: FileSlashContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { isAtRoot, pop, stack } = useCommandNavigation<FileNavigationItem>()
  const remote = useCmdkRemote(containerRef, `${stack.map((s) => s.id).join('/')}:${query}`)

  // Backspace on an empty chip pops a folder level; at the browse root it
  // returns to the parent command menu.
  const popLevel = useCallback(() => {
    if (!isAtRoot) {
      pop()
      return true
    }
    onBack()
    return true
  }, [isAtRoot, pop, onBack])

  useImperativeHandle(ref, () => ({ ...remote, popLevel }), [remote, popLevel])

  const handleSelect = useCallback(
    (item: FileItem) => {
      onAttachFile(item)
      onClose()
    },
    [onAttachFile, onClose]
  )

  // Opens the native file dialog, then hands the chosen files to the
  // composer-level uploader and closes the chip. The dialog blurs the editor
  // (tearing down this chip), but `onUploadFiles` targets state that outlives
  // it, so the upload completes regardless.
  const handleUpload = useCallback(() => {
    if (!onUploadFiles) return
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? [])
      if (files.length > 0) onUploadFiles(files)
    }
    input.click()
    onClose()
  }, [onUploadFiles, onClose])

  return (
    <div ref={containerRef} className='w-72 overflow-hidden'>
      <FileBrowseLevel
        remote
        query={query}
        allowMultiple={false}
        allowFiles
        allowFolders={false}
        enableGlobalSearch
        uploadAction={
          onUploadFiles ? { label: 'Upload from computer', onSelect: handleUpload } : undefined
        }
        onSelectItem={handleSelect}
        onBack={onBack}
        backLabel={backLabel ?? 'Commands'}
        onRequestClose={onClose}
      />
    </div>
  )
}
