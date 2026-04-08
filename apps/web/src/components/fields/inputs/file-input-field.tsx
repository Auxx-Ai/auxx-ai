// apps/web/src/components/fields/inputs/file-input-field.tsx
'use client'

import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { FilePicker } from '~/components/pickers/file-picker'
import { usePropertyContext } from '../property-provider'
import { useFieldFileUpload } from './hooks/use-field-file-upload'

/**
 * FileInputField component for file custom fields.
 * Uses Command-based FilePicker (no nested popover) and module-level
 * completion handlers that survive popover unmount.
 */
export function FileInputField() {
  const { field, recordId } = usePropertyContext()
  const fileOptions = parseFileOptions(field?.options)

  const {
    displayFiles,
    uploadingFiles,
    canAddMore,
    remainingSlots,
    openNativeFilePicker,
    handleBrowseFilesSelected,
    removeFile,
    browseOpen,
    setBrowseOpen,
  } = useFieldFileUpload({ recordId, fieldRef: field.id, fileOptions })

  return (
    <>
      <FilePicker
        files={displayFiles}
        uploadingFiles={uploadingFiles}
        canAddMore={canAddMore}
        onUpload={openNativeFilePicker}
        onBrowse={() => setBrowseOpen(true)}
        onRemove={removeFile}
      />
      {browseOpen && (
        <FileSelectDialog
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          onFilesSelected={handleBrowseFilesSelected}
          allowMultiple={fileOptions.allowMultiple}
          maxSelection={remainingSlots}
          title='Select files'
          confirmText='Attach'
        />
      )}
    </>
  )
}
