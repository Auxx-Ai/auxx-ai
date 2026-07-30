// apps/web/src/components/permissions/ui/grantee-add-panel.tsx
'use client'

import type { ActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { ActorPickerContent } from '~/components/pickers/actor-picker'

export interface GranteeAddPanelProps<TChoice extends string> {
  /** Grantees already on the list — excluded from the picker's results. */
  excludeIds: ActorId[]
  /** Level a fresh batch starts at. */
  defaultChoice: TChoice
  /**
   * The level select for the batch. Deliberately NOT `GranteeList`'s
   * `renderPicker`: that one is row-shaped (it takes an `actorId` so a picker can
   * look up per-grantee data, e.g. the instance dead-grant warning) and none of
   * that has meaning for a batch that has not been written yet.
   */
  renderLevelSelect: (args: {
    value: TChoice
    onChange: (choice: TChoice) => void
    disabled: boolean
  }) => ReactNode
  /** Called once with the whole selection. The only thing that persists anything. */
  onSubmit: (actorIds: ActorId[], choice: TChoice) => void
  onCancel: () => void
  disabled?: boolean
}

/**
 * The staged "add grantees" page: an inline actor picker, one level select for
 * the whole batch, and a submit. **Nothing is written until submit.**
 *
 * This exists because the immediate-persistence alternative sends a wrong
 * notification that can never be corrected. `GranteeAddButton` granted on pick
 * at `defaultChoice`, and `grantInstanceAccess` gates its share notification on
 * `xmax = 0` — insert only. So picking someone told them *"shared a conversation
 * with you"* at Full access, and the admin's next click, which downgrades them to
 * Subject only, is an `ON CONFLICT UPDATE` that notifies nobody. Choosing the
 * level before the first write is what makes the notification true.
 *
 * Host-agnostic and generic over the level vocabulary: mail drills into it as a
 * `CommandNavigation` page inside the share popover, and it is shaped so the
 * instance-access surfaces can adopt it without a second implementation.
 */
export function GranteeAddPanel<TChoice extends string>({
  excludeIds,
  defaultChoice,
  renderLevelSelect,
  onSubmit,
  onCancel,
  disabled = false,
}: GranteeAddPanelProps<TChoice>) {
  const [selected, setSelected] = useState<ActorId[]>([])
  const [choice, setChoice] = useState<TChoice>(defaultChoice)

  // Inside a Popover, Escape closes the whole popover — which on this page
  // discards the host surface rather than the page, and reads as a crash. Take
  // it as "go back" and stop it before Radix sees it.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className='flex flex-col' onKeyDown={handleKeyDown}>
      <ActorPickerContent
        value={selected}
        onChange={setSelected}
        target='both'
        multi
        excludeIds={excludeIds}
        disabled={disabled}
        placeholder='Search people or groups...'
        className='[&_[data-slot=command-list]]:max-h-[220px]'
      />

      <div className='flex items-center justify-between gap-2 border-t pt-2'>
        {renderLevelSelect({ value: choice, onChange: setChoice, disabled })}
        <div className='flex items-center gap-1'>
          <Button variant='ghost' size='sm' onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size='sm'
            disabled={disabled || selected.length === 0}
            onClick={() => onSubmit(selected, choice)}>
            {selected.length > 1 ? `Add ${selected.length}` : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  )
}
