// apps/web/src/components/workflow/nodes/if-else/components/condition-add.tsx

'use client'

import { useCallback, useState, useMemo, memo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useIfElseActions } from '../if-else-context'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'

type ConditionAddProps = { className?: string; caseId: string; disabled?: boolean }

const ConditionAdd = memo(({ className, caseId, disabled }: ConditionAddProps) => {
  const [open, setOpen] = useState(false)
  const { nodeId, addCondition } = useIfElseActions()

  const handleVariableSelect = useCallback(
    (variable: UnifiedVariable) => {
      addCondition(caseId, variable)
      setOpen(false)
    },
    [caseId, addCondition]
  )

  const renderTrigger = useCallback(
    ({ onClick }: { onClick: () => void }) => (
      <Button
        size="sm"
        variant="outline"
        className={className}
        disabled={disabled}
        onClick={onClick}>
        <Plus />
        Add Condition
      </Button>
    ),
    [className, disabled]
  )
  return (
    <VariablePicker
      open={open}
      onOpenChange={setOpen}
      nodeId={nodeId}
      // nodeId={caseId}
      onVariableSelect={handleVariableSelect}
      renderTrigger={renderTrigger}
    />
  )
})
ConditionAdd.displayName = 'ConditionAdd'
export default ConditionAdd
