// apps/web/src/components/manufacturing/builds/build-form-dialog.tsx
'use client'

// The "New build" form (plans/money/tasks/23-build-from-the-part.md §5).
//
// 🛑 **This exists so that `builds.create` is the only door.** Before it,
// `build` was not in `CUSTOM_EDITORS`, so "New build" in the records view
// resolved to the generic `EntityInstanceDialog` -> `record.create` ->
// `UnifiedCrudHandler` and never entered `createBuild` at all — skipping both of
// its validations. A person could raise a build against a purchased washer with
// an empty bill of materials, and nothing said why the resulting run was
// useless.
//
// It is not a money defect (`completeBuild` still refuses without a real
// `part_standard_cost`, README B2). It is the kind that produces support tickets
// rather than restatements, which is exactly the kind a create dialog should
// close.
//
// Three fields, and no `build_status`. Status is `showInDialogs: false` and
// every transition is a procedure with its own preconditions — `build-run-card`
// is the only surface for them, and a run always lands `planned`.

import { FieldType } from '@auxx/database/enums'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

/** Synthetic relationship config for the ad-hoc Part picker — the `subpart-dialog` pattern. */
const PART_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('part', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

interface BuildFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Prefills and LOCKS the part. Set when the dialog was opened from a part —
   * changing it there would silently raise the run against something else.
   */
  partId?: string
  onSuccess?: (buildId: string) => void
}

export function BuildFormDialog({
  open,
  onOpenChange,
  partId: presetPartId,
  onSuccess,
}: BuildFormDialogProps) {
  const partDefId = useResourceProperty('part', 'id')
  const buildDefId = useResourceProperty('build', 'id')
  const utils = api.useUtils()

  const [partId, setPartId] = useState<string>(presetPartId ?? '')
  const [quantity, setQuantity] = useState<number | null>(1)
  const [notes, setNotes] = useState('')

  // A fresh form every time it opens, and the preset re-applied — the dialog is
  // kept mounted by the record editor, so stale state would otherwise carry
  // from the last part somebody opened it against.
  useEffect(() => {
    if (!open) return
    setPartId(presetPartId ?? '')
    setQuantity(1)
    setNotes('')
  }, [open, presetPartId])

  const createBuild = api.builds.create.useMutation({
    onError: (error) => toastError({ title: 'Failed to raise build', description: error.message }),
    onSuccess: async () => {
      // `createBuild` writes on the DEFAULT lane, so the new row is announced —
      // but the acting tab is excluded from its own record frames, so the list
      // it was raised from still has to be told. Same set `build-run-card`
      // invalidates, for the same reason.
      await Promise.all([
        utils.builds.list.invalidate(),
        buildDefId
          ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
          : Promise.resolve(),
      ])
    },
  })

  const canSubmit = !!partId && quantity != null && quantity > 0

  const handleSubmit = async () => {
    if (!canSubmit || quantity == null) return
    try {
      const build = await createBuild.mutateAsync({
        partId,
        quantityPlanned: quantity,
        ...(notes ? { notes } : {}),
      })
      onSuccess?.(build.buildId)
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast. The two refusals a person
      // meets here — a part classified as purchased, and a part with no bill of
      // materials — are sentences from `createBuild`, deliberately not
      // duplicated as a disabled button: this form does not read either fact,
      // and a guess would be worse than the server's own words.
    }
  }

  const isPending = createBuild.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[460px]' position='tc'>
        <DialogHeader>
          <DialogTitle>New Build</DialogTitle>
          <DialogDescription>
            A run always lands planned and writes no stock movements. Start and complete it from the
            build itself.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel className='p-0' resizeId='build-form'>
          <FieldPanelRow
            title='Part'
            type={BaseType.RELATION}
            showIcon
            isRequired
            description='What this run produces'>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={partId && partDefId ? [toRecordId(partDefId, partId)] : []}
              onChange={(value) => {
                const first = (value as RecordId[])[0]
                setPartId(first ? getInstanceId(first) : '')
              }}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              placeholder='Select a part...'
              disabled={isPending || !!presetPartId}
              fieldOptions={{
                relationship: PART_RELATIONSHIP,
                showDefinitionIcon: true,
                // Parts are looked up by SKU, so show it — otherwise a hit on a
                // SKU query renders a name that looks unrelated to what was typed.
                showSecondary: true,
              }}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Quantity'
            type={BaseType.NUMBER}
            showIcon
            isRequired
            description='Units this run intends to produce'>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={quantity}
              onChange={(val) => setQuantity((val as number) ?? null)}
              placeholder='1'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Notes' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={notes}
              onChange={(val) => setNotes((val as string) ?? '')}
              placeholder='Optional notes about this run...'
              disabled={isPending}
              fieldOptions={{ multiline: true }}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Raising...'
            disabled={!canSubmit}
            data-dialog-submit>
            Raise Build <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
