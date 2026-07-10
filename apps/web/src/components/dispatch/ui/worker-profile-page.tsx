// apps/web/src/components/dispatch/ui/worker-profile-page.tsx
'use client'

import type { SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  type AddressStruct,
  AddressStructFields,
} from '~/components/fields/inputs/address-struct-input-field'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
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

interface WorkerProfilePageProps {
  worker: DispatchWorkerRow
  onRemoved: () => void
}

/**
 * Profile page (07-m2-build.md §E.1): board color, home-base address, active toggle, remove
 * action. Every field autosaves on change/blur — `upsertDispatchWorker` only writes the fields
 * present in its input, so per-page saves here never clobber the Hours/Time-off pages' state.
 */
export function WorkerProfilePage({ worker, onRemoved }: WorkerProfilePageProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const [color, setColor] = useState<SelectOptionColor>(
    (worker.color as SelectOptionColor) ?? 'gray'
  )
  const [homeBase, setHomeBase] = useState<AddressStruct>(normalizeAddress(worker.homeBase))
  const [isActive, setIsActive] = useState(worker.isActive)

  // Resync local state when a different worker is opened.
  useEffect(() => {
    setColor((worker.color as SelectOptionColor) ?? 'gray')
    setHomeBase(normalizeAddress(worker.homeBase))
    setIsActive(worker.isActive)
  }, [worker])

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

  function handleColorChange(next: SelectOptionColor) {
    setColor(next)
    upsertWorker.mutate({ userId: worker.userId, color: next })
  }

  function handleAddressBlur() {
    upsertWorker.mutate({ userId: worker.userId, homeBase })
  }

  function handleActiveChange(next: boolean) {
    setIsActive(next)
    setWorkerActive.mutate({ workerId: worker.id, isActive: next })
  }

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
              value={color}
              onChange={handleColorChange}
              disabled={upsertWorker.isPending}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Home base'
          type={BaseType.STRING}
          showIcon
          description='Used for routing on the live map (M3).'>
          <div className='py-2' onBlur={handleAddressBlur}>
            <AddressStructFields
              value={homeBase}
              onChange={setHomeBase}
              className='flex flex-col gap-2'
              disabled={upsertWorker.isPending}
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Active'
          type={BaseType.BOOLEAN}
          showIcon
          description='Inactive workers are hidden from the board.'>
          <Switch
            checked={isActive}
            onCheckedChange={handleActiveChange}
            disabled={setWorkerActive.isPending}
          />
        </FieldPanelRow>
      </FieldPanel>

      <div className='flex justify-end border-t pt-3'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          loading={removeWorker.isPending}
          onClick={handleRemove}
          className='text-destructive hover:text-destructive'>
          <Trash2 /> Remove worker
        </Button>
      </div>

      <ConfirmDialog />
    </div>
  )
}
