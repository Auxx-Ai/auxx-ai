// apps/web/src/components/accounting/ui/journal/journal-entry-attachment.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { FilePicker } from '~/components/pickers/file-picker'
import type { RecordId } from '~/components/resources'

/**
 * The evidence behind a journal entry (`journal_entry_attachment`, a FILE field
 * on the record). Not a `FieldInputAdapter` row: its FILE case reads the record
 * off `usePropertyContext()`, and `useFieldFileUpload` takes it as an argument.
 * Stays editable after Post and Void - nothing here reaches the posted lines.
 */
export function JournalEntryAttachment({
  recordId,
  field,
}: {
  recordId: RecordId
  field: ResourceField
}) {
  const fileOptions = parseFileOptions(field.options)
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
        placeholder='Search files...'
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
