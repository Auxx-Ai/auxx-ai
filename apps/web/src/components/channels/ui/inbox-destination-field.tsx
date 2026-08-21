// apps/web/src/components/channels/ui/inbox-destination-field.tsx
'use client'

import type { Lens } from '@auxx/lib/permissions/visibility/client'
import { DEFAULT_SELECT_OPTION_COLOR, type SelectOptionColor } from '@auxx/types/custom-field'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Lock, UsersIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { InboxNameField } from '~/components/inbox/ui/inbox-name-field'
import {
  GranularPermissionsUpgradeDialog,
  useGranularPermissionsGated,
} from '~/components/mail-permissions/ui/granular-permissions-gate'
import { LensSelect } from '~/components/mail-permissions/ui/lens-select'
import { InboxPicker } from '~/components/pickers/inbox-picker'
import { useInboxes } from '~/components/threads/hooks'
import { invalidateInboxRecordLists } from '~/components/threads/hooks/use-inbox'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

/** Full-width control flush to the row label (matches ConnectionVariableFields). */
const FIELD_TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' }

const CREATE_NEW = '__create_new__'

/** Reactive controller for {@link InboxDestinationField}, returned by {@link useInboxDestination}. */
export interface InboxDestinationController {
  /** Shared (non-personal) inboxes the user can route to. */
  shared: ReturnType<typeof useInboxes>['inboxes']
  selection: string
  setSelection: (value: string) => void
  name: string
  setName: (value: string) => void
  color: SelectOptionColor
  setColor: (color: SelectOptionColor) => void
  accessType: 'anyone' | 'restricted'
  onAccessTypeChange: (value: string) => void
  floorLens: Exclude<Lens, 'none'>
  setFloorLens: (lens: Exclude<Lens, 'none'>) => void
  gated: boolean
  upgradeOpen: boolean
  setUpgradeOpen: (open: boolean) => void
  isCreate: boolean
  /** An existing inbox is picked, or create-mode has a non-empty name. */
  isValid: boolean
  /** The inbox create is in flight (during {@link resolve}). */
  creating: boolean
  /**
   * Resolve the destination inbox id at Connect-click. Existing selection returns as-is;
   * create-mode inserts the inbox first (with the chosen floor) and returns the fresh id.
   */
  resolve: () => Promise<string>
  /** Clear all state (call when the gallery leaves a detail step). */
  reset: () => void
}

/**
 * Owns the inbox-destination state for an inbox-first channel connect: pick an existing shared
 * inbox or create one inline. State is reactive (the caller reads `isValid` for its Connect
 * button and calls `resolve()` on click). Pair with {@link InboxDestinationField} for the view.
 */
export function useInboxDestination(
  initialInboxId?: string,
  options: { enabled?: boolean } = {}
): InboxDestinationController {
  const { inboxes } = useInboxes({ enabled: options.enabled })
  const shared = useMemo(() => inboxes.filter((i) => !i.isPersonal), [inboxes])
  const gated = useGranularPermissionsGated()

  // Optional preselect (e.g. connecting from an inbox's detail page). If the id
  // isn't a shared inbox it simply won't match an option and the user picks one.
  const [selection, setSelection] = useState<string>(initialInboxId ?? '')
  const [name, setName] = useState('')
  const [color, setColor] = useState<SelectOptionColor>(DEFAULT_SELECT_OPTION_COLOR)
  const [accessType, setAccessType] = useState<'anyone' | 'restricted'>('anyone')
  const [floorLens, setFloorLens] = useState<Exclude<Lens, 'none'>>('read')
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const createInbox = api.inbox.create.useMutation()
  const utils = api.useUtils()

  const isCreate = selection === CREATE_NEW
  const isValid = isCreate ? name.trim().length > 0 : selection.length > 0

  // Restricted ⇒ floor `none`, an enterprise floor. Gated orgs get the tease instead of switching.
  const onAccessTypeChange = useCallback(
    (value: string) => {
      if (value === 'restricted' && gated) {
        setUpgradeOpen(true)
        return
      }
      setAccessType(value as 'anyone' | 'restricted')
    },
    [gated]
  )

  const resolve = useCallback(async (): Promise<string> => {
    if (!isCreate) return selection
    const targetLens: Lens = accessType === 'anyone' ? floorLens : 'none'
    const created = await createInbox.mutateAsync({
      name: name.trim(),
      color,
      status: 'ACTIVE',
      defaultLens: targetLens,
    })
    utils.inbox.myLenses.invalidate()
    invalidateInboxRecordLists(utils)
    return created.id
  }, [isCreate, selection, accessType, floorLens, name, color, createInbox, utils])

  const reset = useCallback(() => {
    setSelection('')
    setName('')
    setColor(DEFAULT_SELECT_OPTION_COLOR)
    setAccessType('anyone')
    setFloorLens('read')
    setUpgradeOpen(false)
  }, [])

  return {
    shared,
    selection,
    setSelection,
    name,
    setName,
    color,
    setColor,
    accessType,
    onAccessTypeChange,
    floorLens,
    setFloorLens,
    gated,
    upgradeOpen,
    setUpgradeOpen,
    isCreate,
    isValid,
    creating: createInbox.isPending,
    resolve,
    reset,
  }
}

/**
 * The "Deliver to inbox" picker for a shared channel connect: a select of the org's shared
 * inboxes plus a "Create new inbox" choice that expands a minimal inline create (name +
 * Everyone/Restricted + floor level, plan-gated). Render inside a `FieldPanel`.
 */
export function InboxDestinationField({
  controller,
  disabled,
}: {
  controller: InboxDestinationController
  disabled?: boolean
}) {
  const {
    shared,
    selection,
    setSelection,
    name,
    setName,
    color,
    setColor,
    accessType,
    onAccessTypeChange,
    floorLens,
    setFloorLens,
    gated,
    upgradeOpen,
    setUpgradeOpen,
    isCreate,
  } = controller

  // `InboxPicker` speaks RecordIds; `selection` is a bare instance id, because that is
  // what `resolve()` hands to `pc_inboxId` (see `channels/connect-inbox.ts`). Convert at
  // both edges rather than storing the RecordId — the conversion has to happen somewhere,
  // and doing it here keeps the id the rest of the connect flow sees unambiguous.
  const selectedRecordIds = useMemo(() => {
    const match = shared.find((inbox) => inbox.id === selection)
    return match ? [match.recordId] : []
  }, [shared, selection])

  const handlePick = useCallback(
    (recordIds: string[]) => {
      const picked = shared.find((inbox) => inbox.recordId === recordIds[0])
      setSelection(picked?.id ?? '')
    },
    [shared, setSelection]
  )

  return (
    <>
      <FieldPanelRow title='Deliver to inbox' type={BaseType.STRING} showIcon isRequired>
        <InboxPicker
          inboxes={shared}
          selected={selectedRecordIds}
          onChange={handlePick}
          placeholder='Choose an inbox'
          // Deferred create: flips this field into its inline name/access rows instead of
          // opening `InboxDialog`, which would write the inbox before the channel connects.
          onCreate={() => setSelection(CREATE_NEW)}
          createLabel='Create new inbox'
          selectedLabel={isCreate ? 'New inbox' : undefined}
          triggerProps={FIELD_TRIGGER_PROPS}
          disabled={disabled}
        />
      </FieldPanelRow>

      {isCreate && (
        <>
          <FieldPanelRow title='Inbox name' type={BaseType.STRING} showIcon isRequired>
            <InboxNameField
              name={name}
              onNameChange={setName}
              color={color}
              onColorChange={setColor}
              placeholder='e.g. Support'
              disabled={disabled}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Access' type={BaseType.STRING} showIcon>
            <RadioGroup
              value={accessType}
              onValueChange={onAccessTypeChange}
              className='grid gap-2 py-2 pe-2'>
              <RadioGroupItemCard
                value='anyone'
                label='Everyone'
                icon={<UsersIcon />}
                description='Everyone in the organization, at a chosen level'
              />
              <RadioGroupItemCard
                value='restricted'
                label='Restricted'
                sublabel={gated ? 'Upgrade' : undefined}
                icon={<Lock />}
                description='Only people you add later in inbox settings'
              />
            </RadioGroup>
          </FieldPanelRow>

          {accessType === 'anyone' && (
            <FieldPanelRow title='Everyone can see' type={BaseType.STRING} showIcon>
              <LensSelect
                value={floorLens}
                onChange={(choice) => choice !== 'manager' && setFloorLens(choice)}
                size='default'
                variant='transparent'
                className='w-full ps-0 pe-1'
              />
            </FieldPanelRow>
          )}
        </>
      )}

      <GranularPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
