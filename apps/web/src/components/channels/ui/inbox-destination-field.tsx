// apps/web/src/components/channels/ui/inbox-destination-field.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { Lens } from '@auxx/lib/permissions/visibility/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Lock, UsersIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  MailPermissionsUpgradeDialog,
  useMailPermissionsGated,
} from '~/components/mail-permissions/ui/enterprise-gate'
import { LensSelect } from '~/components/mail-permissions/ui/lens-select'
import { useInboxes } from '~/components/threads/hooks'
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
export function useInboxDestination(): InboxDestinationController {
  const { inboxes } = useInboxes()
  const shared = useMemo(() => inboxes.filter((i) => !i.isPersonal), [inboxes])
  const gated = useMailPermissionsGated()

  const [selection, setSelection] = useState<string>('')
  const [name, setName] = useState('')
  const [accessType, setAccessType] = useState<'anyone' | 'restricted'>('anyone')
  const [floorLens, setFloorLens] = useState<Exclude<Lens, 'none'>>('full')
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
      status: 'ACTIVE',
      defaultLens: targetLens,
    })
    utils.inbox.getAll.invalidate()
    utils.inbox.myLenses.invalidate()
    utils.record.listAll.invalidate({ entityDefinitionId: 'inbox' })
    return created.id
  }, [isCreate, selection, accessType, floorLens, name, createInbox, utils])

  const reset = useCallback(() => {
    setSelection('')
    setName('')
    setAccessType('anyone')
    setFloorLens('full')
    setUpgradeOpen(false)
  }, [])

  return {
    shared,
    selection,
    setSelection,
    name,
    setName,
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
 * Everyone/Restricted + floor level, enterprise-gated). Render inside a `FieldPanel`.
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
    accessType,
    onAccessTypeChange,
    floorLens,
    setFloorLens,
    gated,
    upgradeOpen,
    setUpgradeOpen,
    isCreate,
  } = controller

  // Existing shared inboxes + a trailing "Create new inbox" choice.
  const inboxOptions = useMemo<SelectOption[]>(
    () => [
      ...shared.map((inbox) => ({ value: inbox.id, label: inbox.name })),
      { value: CREATE_NEW, label: 'Create new inbox' },
    ],
    [shared]
  )

  return (
    <>
      <FieldPanelRow title='Deliver to inbox' type={BaseType.STRING} showIcon isRequired>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: inboxOptions }}
          value={selection}
          onChange={(v) => setSelection(Array.isArray(v) ? (v[0] ?? '') : ((v as string) ?? ''))}
          placeholder='Choose an inbox'
          triggerProps={FIELD_TRIGGER_PROPS}
          disabled={disabled}
        />
      </FieldPanelRow>

      {isCreate && (
        <>
          <FieldPanelRow title='Inbox name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(v) => setName((v as string) ?? '')}
              placeholder='e.g. Support'
              triggerProps={FIELD_TRIGGER_PROPS}
              disabled={disabled}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Access' type={BaseType.STRING} showIcon>
            <RadioGroup
              value={accessType}
              onValueChange={onAccessTypeChange}
              className='grid gap-2 sm:grid-cols-2'>
              <RadioGroupItemCard
                value='anyone'
                label='Everyone'
                icon={<UsersIcon />}
                description='Everyone in the organization, at a chosen level'
              />
              <RadioGroupItemCard
                value='restricted'
                label='Restricted'
                sublabel={gated ? 'Enterprise' : undefined}
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

      <MailPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
