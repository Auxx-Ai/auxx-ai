// apps/web/src/components/accounting/ui/journal/journal-entry-attachment.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { FilePicker } from '~/components/pickers/file-picker'
import type { RecordId } from '~/components/resources'

/**
 * The evidence behind a journal entry - the accountant's memo, a statement, a
 * photo of the paper (`journal_entry_attachment`, a FILE field on the draft
 * record).
 *
 * ⚠️ `useFieldFileUpload` takes `recordId`/`fieldRef` as plain arguments, so no
 * `PropertyProvider` indirection is needed here - the same reason
 * `line-photo-popover.tsx` mounts the hook directly. The drawer's own
 * `FieldInputAdapter` rows cannot serve this field: its FILE case renders
 * `FileInputField`, which reads `field` and `recordId` off
 * `usePropertyContext()` rather than the value/onChange pair every other row in
 * that panel passes.
 *
 * 🛑 The attachment stays editable after the entry posts, unlike every other
 * control in the drawer. It is EVIDENCE about the entry rather than part of it:
 * nothing here reaches `GlPostingLine`, which is what "correct by reversal,
 * never by edit" protects. A statement that turns up a week after the close is
 * exactly the thing somebody needs to be able to staple on.
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
