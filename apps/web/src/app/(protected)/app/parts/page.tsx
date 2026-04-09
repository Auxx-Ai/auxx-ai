// apps/web/src/app/(protected)/app/parts/page.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { useCallback, useState } from 'react'
import { PartFormDialog } from '~/components/manufacturing/parts/part-form-dialog'
import { RecordsView } from '~/components/records'
import { useRecordInvalidation, useResourceProperty } from '~/components/resources'
import { api } from '~/trpc/react'

export default function PartsPage() {
  const [isCreateOpen, setIsCreateOpen] = useQueryState('create', parseAsBoolean.withDefault(false))
  const [editingRecordId, setEditingRecordId] = useState<RecordId | null>(null)
  const partDefId = useResourceProperty('part', 'id')
  const { onRecordCreated } = useRecordInvalidation()
  const utils = api.useUtils()

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsCreateOpen(open || null)
      if (!open) setEditingRecordId(null)
    },
    [setIsCreateOpen]
  )

  const handleEditRecord = useCallback((recordId: RecordId) => {
    setEditingRecordId(recordId)
  }, [])

  const handleSuccess = useCallback(() => {
    handleDialogOpenChange(false)
    if (partDefId) {
      onRecordCreated(partDefId)
      utils.record.listFiltered.invalidate()
    }
  }, [handleDialogOpenChange, partDefId, onRecordCreated, utils.record.listFiltered])

  return (
    <>
      <RecordsView
        slug='parts'
        basePath='/app/parts'
        embedded
        renderCreateDialog={false}
        onEditRecord={handleEditRecord}
      />

      <PartFormDialog
        open={isCreateOpen || !!editingRecordId}
        onOpenChange={handleDialogOpenChange}
        recordId={editingRecordId ?? undefined}
        onSuccess={handleSuccess}
      />
    </>
  )
}
