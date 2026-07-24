// apps/web/src/components/mail-permissions/ui/mail-grantee-list.tsx
'use client'

import { LENS_LABELS, type LensChoice } from '@auxx/lib/permissions/visibility/client'
import type { ActorId } from '@auxx/types/actor'
import type { ReactNode } from 'react'
import { GranteeAddButton, GranteeList } from '~/components/permissions/ui/grantee-list'
import { LensSelect } from './lens-select'

/**
 * Mail-specialized {@link GranteeList} — the neutral list wired with the mail
 * `LensSelect` picker and `LENS_LABELS`, new grantees defaulting to Full. Keeps
 * the exact API the mail surfaces already use (`onChangeLens`, `includeManager`)
 * so the Share card / thread popover / inbox pages behave identically after the
 * list was lifted to a neutral home (§4, resolved open item #1).
 */
export function MailGranteeList({
  grants,
  onGrant,
  onChangeLens,
  onRevoke,
  includeManager = false,
  disabled = false,
  emptyHint,
  lockedActorIds,
  hideAddButton,
}: {
  grants: Array<{ actorId: ActorId; choice: LensChoice }>
  onGrant: (actorId: ActorId, choice: LensChoice) => void
  onChangeLens: (actorId: ActorId, choice: LensChoice) => void
  onRevoke: (actorId: ActorId) => void
  includeManager?: boolean
  disabled?: boolean
  emptyHint?: string
  lockedActorIds?: ActorId[]
  hideAddButton?: boolean
}) {
  return (
    <GranteeList<LensChoice>
      grants={grants}
      onGrant={onGrant}
      onChange={onChangeLens}
      onRevoke={onRevoke}
      defaultChoice='full'
      renderLockedLabel={(choice) => LENS_LABELS[choice].label}
      renderPicker={({ value, onChange, disabled: rowDisabled }) => (
        <LensSelect
          value={value}
          onChange={onChange}
          includeManager={includeManager}
          disabled={rowDisabled}
          size='sm'
          variant='transparent'
          className='h-7 w-36'
        />
      )}
      disabled={disabled}
      emptyHint={emptyHint}
      lockedActorIds={lockedActorIds}
      hideAddButton={hideAddButton}
    />
  )
}

/** Mail-specialized {@link GranteeAddButton} — new grantees default to Full. */
export function MailGranteeAddButton({
  grants,
  onGrant,
  disabled = false,
  children,
}: {
  grants: Array<{ actorId: ActorId; choice: LensChoice }>
  onGrant: (actorId: ActorId, choice: LensChoice) => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <GranteeAddButton<LensChoice>
      grants={grants}
      onGrant={onGrant}
      defaultChoice='full'
      disabled={disabled}>
      {children}
    </GranteeAddButton>
  )
}
