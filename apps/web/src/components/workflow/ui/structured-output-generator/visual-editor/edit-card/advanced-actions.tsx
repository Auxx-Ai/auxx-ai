// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/edit-card/advanced-actions.tsx
import React, { type FC } from 'react'
import { Button } from '@auxx/ui/components/button'
import { useKeyPress } from '../../hooks/use-key-press'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '../../utils'

type AdvancedActionsProps = {
  isConfirmDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

const Key = (props: { keyName: string }) => {
  const { keyName } = props
  return (
    <kbd className="system-kbd flex h-4 min-w-4 items-center justify-center rounded-[4px] px-px">
      {keyName}
    </kbd>
  )
}

const AdvancedActions: FC<AdvancedActionsProps> = ({ isConfirmDisabled, onCancel, onConfirm }) => {
  useKeyPress(
    [`${getKeyboardKeyCodeBySystem('ctrl')}.enter`],
    (e) => {
      e.preventDefault()
      onConfirm()
    },
    { exactMatch: true, useCapture: true }
  )

  return (
    <div className="flex items-center gap-x-1">
      <Button size="xs" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button disabled={isConfirmDisabled} size="xs" variant="default" onClick={onConfirm}>
        <span>Confirm</span>
        <div className="flex items-center gap-x-0.5">
          <Key keyName={getKeyboardKeyNameBySystem('ctrl')} />
          <Key keyName="⏎" />
        </div>
      </Button>
    </div>
  )
}

export default React.memo(AdvancedActions)
