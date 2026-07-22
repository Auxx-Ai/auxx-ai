// apps/web/src/components/dispatch/ui/team-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { DEFAULT_SELECT_OPTION_COLOR, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
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
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { AddressStruct } from '~/components/fields/inputs/address-struct-input-field'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ColorTagPicker } from '~/components/tags/ui/color-tag-picker'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
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

interface TeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Team worker id to edit; null opens in create mode (45-teams.md §6). */
  teamWorkerId: string | null
}

/**
 * Create/edit dialog for a dispatch Team — a `DispatchWorker` (`type:'team'`) whose members are
 * other individual workers (45-teams.md §1.B/§6). A single-page form (unlike the multi-tab
 * `WorkerDialog`): name, board color, home base, and a members picker restricted to
 * `type==='individual'` workers. The closed shell renders null so each open mounts fresh.
 */
export function TeamDialog({ open, onOpenChange, teamWorkerId }: TeamDialogProps) {
  if (!open) return null
  return <TeamDialogContent open={open} onOpenChange={onOpenChange} teamWorkerId={teamWorkerId} />
}

function TeamDialogContent({ open, onOpenChange, teamWorkerId }: TeamDialogProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: workers } = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const team = (teamWorkerId && workers?.find((w) => w.id === teamWorkerId)) || null
  const individuals = (workers ?? []).filter((w) => w.type === 'individual')

  const [name, setName] = useState(team?.name ?? '')
  const [color, setColor] = useState<SelectOptionColor>(
    (team?.color as SelectOptionColor) ?? DEFAULT_SELECT_OPTION_COLOR
  )
  const [homeBase, setHomeBase] = useState<AddressStruct>(normalizeAddress(team?.homeBase ?? null))
  const [memberWorkerIds, setMemberWorkerIds] = useState<string[]>(
    (team?.members ?? []).map((m) => m.workerId)
  )
  const [search, setSearch] = useState('')

  const invalidate = () => utils.dispatch.listWorkers.invalidate()

  const createTeam = api.dispatch.createTeam.useMutation({
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
    },
    onError: (error) => toastError({ title: 'Error creating team', description: error.message }),
  })
  const updateTeam = api.dispatch.updateTeam.useMutation({
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
    },
    onError: (error) => toastError({ title: 'Error saving team', description: error.message }),
  })
  const removeWorker = api.dispatch.removeWorker.useMutation({
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
    },
    onError: (error) => toastError({ title: 'Error removing team', description: error.message }),
  })

  const isSaving = createTeam.isPending || updateTeam.isPending
  const trimmedName = name.trim()

  function handleSave() {
    if (!trimmedName) return
    if (team) {
      updateTeam.mutate({
        teamWorkerId: team.id,
        name: trimmedName,
        color,
        homeBase,
        memberWorkerIds,
      })
    } else {
      createTeam.mutate({ name: trimmedName, color, homeBase, memberWorkerIds })
    }
  }

  async function handleRemove() {
    if (!team) return
    const confirmed = await confirm({
      title: 'Remove team?',
      description: `This removes "${team.name ?? 'this team'}" from the dispatch board. Its assigned visits keep their assignee — only the board column disappears.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeWorker.mutate({ workerId: team.id })
  }

  function toggleMember(workerId: string) {
    setMemberWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    )
  }

  const filteredIndividuals = individuals.filter((worker) => {
    if (!search) return true
    const label = (worker.user?.name ?? worker.user?.email ?? '').toLowerCase()
    return label.includes(search.toLowerCase())
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent position='tc' size='lg'>
          <DialogHeader>
            <DialogTitle>{team ? 'Edit team' : 'Add a team'}</DialogTitle>
            <DialogDescription>
              A team is one dispatchable board row made of existing individual workers.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4'>
            <FieldPanel
              orientation='responsive'
              breakpoint='md'
              resizeId='team-form'
              defaultLabelWidth={140}
              className='p-0'>
              <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={name}
                  onChange={(next) => setName(next as string)}
                  placeholder='e.g. Install crew'
                  disabled={isSaving}
                />
              </FieldPanelRow>

              <FieldPanelRow title='Board color' type={BaseType.ENUM} showIcon>
                <div className='py-2'>
                  <ColorTagPicker value={color} onChange={setColor} disabled={isSaving} />
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
                    value={homeBase}
                    onChange={(next) => setHomeBase(next as AddressStruct)}
                    disabled={isSaving}
                  />
                </div>
              </FieldPanelRow>
            </FieldPanel>

            <div className='flex flex-col gap-2'>
              <p className='text-sm font-medium'>Members</p>
              <p className='text-muted-foreground text-xs'>
                Individual workers assigned to this team.
              </p>
              <Command className='rounded-lg border' shouldFilter={false}>
                <CommandInput
                  placeholder='Search workers...'
                  value={search}
                  onValueChange={setSearch}
                  disabled={isSaving}
                />
                <CommandList className='max-h-56'>
                  <CommandEmpty>No individual workers found.</CommandEmpty>
                  <CommandGroup>
                    {filteredIndividuals.map((worker) => {
                      const label = worker.user?.name || worker.user?.email || 'Unknown member'
                      const isSelected = memberWorkerIds.includes(worker.id)
                      return (
                        <CommandItem
                          key={worker.id}
                          value={worker.id}
                          onSelect={() => toggleMember(worker.id)}
                          className='flex items-center gap-2'>
                          <Avatar className='size-5'>
                            <AvatarImage src={worker.user?.image ?? undefined} />
                            <AvatarFallback className='text-[10px]'>
                              {label.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className='flex-1 truncate'>{label}</span>
                          <Checkbox checked={isSelected} className='pointer-events-none' />
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>

          <DialogFooter className='sm:justify-between'>
            <div>
              {team && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  loading={removeWorker.isPending}
                  onClick={handleRemove}
                  className='text-destructive hover:text-destructive'>
                  <Trash2 /> Remove team
                </Button>
              )}
            </div>
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={isSaving}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleSave}
                loading={isSaving}
                loadingText={team ? 'Saving...' : 'Creating...'}
                disabled={!trimmedName}
                data-dialog-submit>
                {team ? 'Save' : 'Create team'} <KbdSubmit variant='outline' size='sm' />
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  )
}
