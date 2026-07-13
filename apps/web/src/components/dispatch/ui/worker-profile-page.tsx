// apps/web/src/components/dispatch/ui/worker-profile-page.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Trash2 } from 'lucide-react'
import type { AddressStruct } from '~/components/fields/inputs/address-struct-input-field'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { ColorTagPicker } from '~/components/tags/ui/color-tag-picker'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DispatchWorkerRow } from './worker-card'

const EMPTY_ADDRESS: AddressStruct = {
  street1: '',
  street2: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
}

/** `DispatchWorkerRow['homeBase']` types `street2` optional; the UI's `AddressStruct` doesn't. */
function normalizeAddress(value: DispatchWorkerRow['homeBase']): AddressStruct {
  if (!value) return EMPTY_ADDRESS
  return { ...value, street2: value.street2 ?? '' }
}

interface WorkerProfileDraft {
  color: SelectOptionColor
  homeBase: AddressStruct
  isActive: boolean
  routeStartAtHome: boolean
  routeEndAtHome: boolean
}

interface WorkerProfilePageProps {
  worker: DispatchWorkerRow
  onRemoved: () => void
}

/**
 * Profile page (07-m2-build.md §E.1): board color, home-base address, active toggle,
 * start/end-at-home route switches (v4/01-planner-polish.md Phase 3), remove action. Edits
 * collect into one page-level {@link useDirtyDraft} + a dialog footer instead of autosaving per
 * field (10-settings-forms-unification.md). Save fans out to `upsertWorker` (color + home base +
 * route flags) and `setWorkerActive` (only when the toggle changed).
 */
export function WorkerProfilePage({ worker, onRemoved }: WorkerProfilePageProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const invalidate = () => utils.dispatch.listWorkers.invalidate()

  const upsertWorker = api.dispatch.upsertWorker.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error saving worker', description: error.message }),
  })

  const setWorkerActive = api.dispatch.setWorkerActive.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error updating worker', description: error.message }),
  })

  const removeWorker = api.dispatch.removeWorker.useMutation({
    onSuccess: () => {
      invalidate()
      onRemoved()
    },
    onError: (error) => toastError({ title: 'Error removing worker', description: error.message }),
  })

  const isSaving = upsertWorker.isPending || setWorkerActive.isPending

  // Rebuilt each render from the worker prop; `useDirtyDraft` reseeds by value, so opening a
  // different worker swaps the draft while a background `listWorkers` refetch never clobbers edits.
  const server: WorkerProfileDraft = {
    color: (worker.color as SelectOptionColor) ?? 'gray',
    homeBase: normalizeAddress(worker.homeBase),
    isActive: worker.isActive,
    routeStartAtHome: worker.routeStartAtHome,
    routeEndAtHome: worker.routeEndAtHome,
  }

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving,
    onSave: (next) => {
      const addressChanged = JSON.stringify(next.homeBase) !== JSON.stringify(server.homeBase)
      const routeFlagsChanged =
        next.routeStartAtHome !== server.routeStartAtHome ||
        next.routeEndAtHome !== server.routeEndAtHome
      if (next.color !== server.color || addressChanged || routeFlagsChanged) {
        upsertWorker.mutate({
          userId: worker.userId,
          color: next.color,
          homeBase: next.homeBase,
          routeStartAtHome: next.routeStartAtHome,
          routeEndAtHome: next.routeEndAtHome,
        })
      }
      if (next.isActive !== server.isActive) {
        setWorkerActive.mutate({ workerId: worker.id, isActive: next.isActive })
      }
    },
  })

  async function handleRemove() {
    const confirmed = await confirm({
      title: 'Remove worker?',
      description: `This removes "${worker.user?.name ?? 'this worker'}" from the dispatch board. Their assigned visits keep their assignee — only the board column disappears.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeWorker.mutate({ workerId: worker.id })
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='worker-profile'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Board color' type={BaseType.ENUM} showIcon>
          <div className='py-2'>
            <ColorTagPicker
              value={draft.color}
              onChange={(color) => patch({ color })}
              disabled={isSaving}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Home base'
          type={BaseType.STRING}
          showIcon
          description='Used for routing on the live map (M3).'>
          <div className='py-2'>
            <FieldInputAdapter
              fieldType={FieldType.ADDRESS_STRUCT}
              value={draft.homeBase}
              onChange={(homeBase) => patch({ homeBase: homeBase as AddressStruct })}
              disabled={isSaving}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Active'
          type={BaseType.BOOLEAN}
          showIcon
          description='Inactive workers are hidden from the board.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.isActive}
            onChange={(isActive) => patch({ isActive: isActive as boolean })}
            disabled={isSaving}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Start at home'
          type={BaseType.BOOLEAN}
          showIcon
          description='Route begins at the business address.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.routeStartAtHome}
            onChange={(routeStartAtHome) =>
              patch({ routeStartAtHome: routeStartAtHome as boolean })
            }
            disabled={isSaving}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='End at home'
          type={BaseType.BOOLEAN}
          showIcon
          description='Route ends at the business address.'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.routeEndAtHome}
            onChange={(routeEndAtHome) => patch({ routeEndAtHome: routeEndAtHome as boolean })}
            disabled={isSaving}
          />
        </FieldPanelRow>
      </FieldPanel>

      <DialogFooter className='border-t pt-3 sm:justify-between'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          loading={removeWorker.isPending}
          onClick={handleRemove}
          className='text-destructive hover:text-destructive'>
          <Trash2 /> Remove worker
        </Button>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={discard}
            disabled={!dirty || isSaving}>
            Discard
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={save}
            loading={isSaving}
            loadingText='Saving...'
            disabled={!dirty}
            data-dialog-submit>
            Save <KbdSubmit variant='outline' size='sm' />
          </Button>
        </div>
      </DialogFooter>

      <ConfirmDialog />
    </div>
  )
}
