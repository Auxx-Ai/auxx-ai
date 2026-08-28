// apps/web/src/components/purchasing/record-documents-card.tsx
'use client'

// `purchase_order:documents` / `vendor_bill:documents` — the files that belong to
// this record (plans/purchasing/08-documents-on-records.md P21).
//
// Every field it renders is `showInPanel: false`, so this card is their ONLY
// surface. That is the point: the Details panel keeps showing business fields,
// and files get a row with a type icon, a name, a size and a preview — none of
// which a bare field row in a list of twenty does well.
//
// ONE FLAT LIST across both slots. The generated PDF sorts first and wears a lock;
// after that a bill's own document and its supporting paperwork read as one pile,
// which is how a person thinks about "the files on this bill". The two fields stay
// separate in the DATA (P18 — a later extraction pass has to know which file is the
// bill) and merge only here, in the presentation.

import { PermissionKey } from '@auxx/lib/permissions/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { type FileRef, getFileRefDownloadUrl, parseFileRef } from '@auxx/types/file-ref'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { formatBytes } from '@auxx/utils/file'
import { Download, Lock, Paperclip, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { AttachmentPreview } from '~/components/attachments/attachment-preview'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { FileSelectDialog } from '~/components/file-select/file-select-dialog'
import { FileIcon } from '~/components/files/utils/file-icon'
import { Tooltip } from '~/components/global/tooltip'
import { useResourceFields } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'

interface DocumentRow {
  /** `FieldValue.id` — what `removeFile` takes. */
  id: string
  ref: FileRef
  name: string
  mimeType: string | null
  size: number | null
  /** The generated PDF: no remove, no replace, and a lock in the secondary slot. */
  readOnly: boolean
  /** Which slot's `removeFile` owns this row. */
  remove?: (fieldValueId: string) => Promise<void>
}

/**
 * One slot's worth of upload state.
 *
 * `useFieldFileUpload` is per-field, so the card calls it once per slot and merges
 * the results. An absent field (an org that somehow has not run migration 112)
 * yields an empty `fieldRef`, which resolves to a store key nothing subscribes to
 * and therefore an empty `displayFiles` — the row simply does not appear. The Add
 * affordance is gated on the field existing, so nothing can write through a ref
 * that does not resolve.
 */
function useSlot(recordId: RecordId, field: ResourceField | undefined) {
  return useFieldFileUpload({
    recordId,
    fieldRef: field?.id ?? '',
    fileOptions: parseFileOptions(field?.options),
  })
}

function RecordDocumentsCard({
  recordId,
  primaryAttribute,
  attachmentsAttribute,
}: DrawerTabProps & { primaryAttribute: string; attachmentsAttribute: string }) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { fields, isLoading } = useResourceFields(entityDefinitionId)

  const { primaryField, attachmentsField } = useMemo(() => {
    const byAttribute = new Map(
      fields.filter((f) => f.systemAttribute).map((f) => [f.systemAttribute as string, f])
    )
    return {
      primaryField: byAttribute.get(primaryAttribute),
      attachmentsField: byAttribute.get(attachmentsAttribute),
    }
  }, [fields, primaryAttribute, attachmentsAttribute])

  // 🛑 Read-only comes from the ONE capability every other surface reads —
  // `updatable === false`, the same question `toPanelField` asks for the Details
  // panel and `selectable-table-cell` asks for the grid. Deriving it any other way
  // here would make this card a second opinion on whether the generated PDF can be
  // replaced, and the answer that matters is the server's.
  const primaryReadOnly = primaryField?.capabilities?.updatable === false

  const primary = useSlot(recordId, primaryField)
  const attachments = useSlot(recordId, attachmentsField)

  // Preview and download BOTH sit behind `filesView`: the tRPC preview procedure
  // asserts it, and `/api/files/download/[fileId]` — the only URL the app has for
  // a FILE field's bytes — asserts it too. So a member without it can do neither,
  // and rendering the affordances would hand them buttons that 403. They still see
  // that the files exist, which is the same thing the field row would tell them.
  const { can } = useAccess()
  const canViewFiles = can(PermissionKey.filesView)

  const [openRefs, setOpenRefs] = useState<ReadonlySet<string>>(() => new Set())
  const toggleOpen = useCallback((ref: string) => {
    setOpenRefs((current) => {
      const next = new Set(current)
      if (!next.delete(ref)) next.add(ref)
      return next
    })
  }, [])

  const rows = useMemo<DocumentRow[]>(
    () => [
      ...primary.displayFiles.map((f) => ({
        id: f.id,
        ref: f.ref,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        readOnly: primaryReadOnly,
        remove: primaryReadOnly ? undefined : primary.removeFile,
      })),
      ...attachments.displayFiles.map((f) => ({
        id: f.id,
        ref: f.ref,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        readOnly: false,
        remove: attachments.removeFile,
      })),
    ],
    [
      primary.displayFiles,
      primary.removeFile,
      attachments.displayFiles,
      attachments.removeFile,
      primaryReadOnly,
    ]
  )

  // An in-flight upload owns a row before its value lands, so the list does not sit
  // empty while a file is going up.
  const uploading = [...primary.uploadingFiles, ...attachments.uploadingFiles]

  // The writable slot the Add button targets: a bill's own document while it is
  // empty (single-valued, so it replaces), otherwise the attachments list.
  const addTarget =
    !primaryReadOnly && primaryField && primary.displayFiles.length === 0 ? primary : attachments
  const addTargetField = addTarget === primary ? primaryField : attachmentsField

  if (rows.length === 0 && uploading.length === 0 && !addTargetField) return null

  return (
    <>
      {addTargetField && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={addTarget.openNativeFilePicker}>
            <Plus /> Add
          </Button>
        </DrawerCardActions>
      )}

      <TreeRowList
        items={rows}
        getKey={(row) => row.id}
        loading={isLoading && rows.length === 0}
        skeletonCount={2}
        visibleLimit={6}
        showMoreIcon={<Paperclip className='size-4 text-muted-foreground' />}
        renderRow={(row) => (
          <DocumentTreeRow
            row={row}
            canViewFiles={canViewFiles}
            isOpen={openRefs.has(row.ref)}
            onToggleOpen={() => toggleOpen(row.ref)}
          />
        )}
      />

      {uploading.map((file) => (
        <TreeRow
          key={file.id}
          icon={<FileIcon mimeType={file.mimeType ?? undefined} className='size-4 text-gray-500' />}
          title={file.name}
          secondary={
            <span className='text-muted-foreground text-xs'>
              {file.progress !== undefined ? `${Math.round(file.progress)}%` : 'Uploading…'}
            </span>
          }
        />
      ))}

      {addTargetField && addTarget.browseOpen && (
        <FileSelectDialog
          open={addTarget.browseOpen}
          onOpenChange={addTarget.setBrowseOpen}
          onFilesSelected={addTarget.handleBrowseFilesSelected}
          allowMultiple={parseFileOptions(addTargetField.options).allowMultiple}
          maxSelection={addTarget.remainingSlots}
          title='Select files'
          confirmText='Attach'
        />
      )}
    </>
  )
}

function DocumentTreeRow({
  row,
  canViewFiles,
  isOpen,
  onToggleOpen,
}: {
  row: DocumentRow
  canViewFiles: boolean
  isOpen: boolean
  onToggleOpen: () => void
}) {
  // `asset:<id>` / `file:<id>` maps straight onto `AttachmentPreview`'s
  // `type` + `id` — the two halves of a FileRef are exactly its two props.
  const { sourceType, id } = parseFileRef(row.ref)

  return (
    <TreeRow
      icon={<FileIcon mimeType={row.mimeType ?? undefined} className='size-4 text-gray-500' />}
      title={row.name}
      secondary={
        <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
          {row.size !== null && <span>{formatBytes(row.size)}</span>}
          {row.readOnly && (
            <Tooltip content='Generated automatically — replaced each time this document is sent'>
              <Lock className='size-3' />
            </Tooltip>
          )}
        </span>
      }
      expandable={canViewFiles}
      isOpen={isOpen}
      onToggleOpen={canViewFiles ? onToggleOpen : undefined}
      actions={
        <>
          {canViewFiles && (
            <Tooltip content='Download'>
              <Button variant='ghost' size='icon-xs' asChild>
                <a href={`${getFileRefDownloadUrl(row.ref)}?download=1`} download={row.name}>
                  <Download />
                </a>
              </Button>
            </Tooltip>
          )}
          {row.remove && (
            <Tooltip content='Remove'>
              <Button variant='ghost' size='icon-xs' onClick={() => row.remove?.(row.id)}>
                <Trash2 />
              </Button>
            </Tooltip>
          )}
        </>
      }>
      {/* Children only render while open (`BaseTreeRow`), so a collapsed row never
          asks for a presigned URL. */}
      <div className='py-2 pl-6'>
        <AttachmentPreview
          type={sourceType}
          id={id}
          knownMimeType={row.mimeType ?? undefined}
          filename={row.name}
          height={360}
        />
      </div>
    </TreeRow>
  )
}

/**
 * The PO's own PDF plus whatever the vendor sent back.
 *
 * The generated row appears only once a PDF exists — for a PO that means once it
 * has been sent or previewed. Before that the card is just the attachments.
 */
export function PurchaseOrderDocumentsCard(props: DrawerTabProps) {
  return (
    <RecordDocumentsCard
      {...props}
      primaryAttribute='purchase_order_pdf_asset'
      attachmentsAttribute='purchase_order_attachments'
    />
  )
}

/**
 * The bill's paper.
 *
 * `document` is a single slot on purpose (P18) — it is what a later extraction pass
 * parses, and "the first element of the attachments array" is a convention that
 * survives exactly until somebody reorders. Nothing renders INTO it, so unlike the
 * PO's generated slot it is fully user-writable.
 */
export function VendorBillDocumentsCard(props: DrawerTabProps) {
  return (
    <RecordDocumentsCard
      {...props}
      primaryAttribute='vendor_bill_document'
      attachmentsAttribute='vendor_bill_attachments'
    />
  )
}
