// apps/web/src/components/workflow/nodes/core/scheduled-trigger/components/interval-selector.tsx

'use client'

import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ScheduledTriggerUIConfig } from '../types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
interface IntervalSelectorProps {
  config: ScheduledTriggerUIConfig
  onIntervalChange: (interval: ScheduledTriggerUIConfig['triggerInterval']) => void
  onValueChange: (value: number | string, isVariable?: boolean) => void
  disabled?: boolean
  nodeId: string
}

/**
 * Enhanced interval selector with presets and validation
 */
export const IntervalSelector: React.FC<IntervalSelectorProps> = ({
  config,
  onIntervalChange,
  onValueChange,
  disabled,
  nodeId,
}) => {
  const currentValue =
    config.triggerInterval !== 'custom'
      ? config.timeBetweenTriggers[config.triggerInterval] || 1
      : 1

  // Check if the current value is in constant mode
  const isConstantValue = config.timeBetweenTriggers.isConstant ?? true

  // Handle display for both number and string values
  const getCurrentValueForDisplay = () => {
    if (typeof currentValue === 'string') {
      return currentValue // Variable reference
    }
    return currentValue.toString()
  }

  return (
    <div className="space-y-4">
      {/* Interval Type and Value */}
      <VarEditorField>
        <div className="flex items-center gap-1 flex-row">
          <Select
            value={config.triggerInterval}
            onValueChange={onIntervalChange}
            disabled={disabled}>
            <SelectTrigger id="interval-type" variant="transparent" className="w-30">
              <SelectValue placeholder="Select interval type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
              <SelectItem value="weeks">Weeks</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1">
            <VarEditor
              value={getCurrentValueForDisplay()}
              nodeId={nodeId}
              isConstantMode={isConstantValue}
              onConstantModeChange={(isConstant) => {
                // Handle mode changes
                const currentDisplayValue = getCurrentValueForDisplay()
                if (isConstant) {
                  // Switching to constant mode - parse as number
                  const numValue = parseInt(currentDisplayValue) || 1
                  onValueChange(numValue, false)
                } else {
                  // Switching to variable mode - keep as string
                  onValueChange(currentDisplayValue, true)
                }
              }}
              onChange={(value, isConstantMode) => {
                if (isConstantMode) {
                  // In constant mode, parse as number
                  const numValue = parseInt(value) || 1
                  onValueChange(numValue, false)
                } else {
                  // In variable mode, pass the variable reference as string
                  onValueChange(value, true)
                }
              }}
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              placeholder="Select variable..."
              placeholderConstant="Enter duration..."
              allowConstant
              disabled={disabled}
            />
          </div>
        </div>
      </VarEditorField>
    </div>
  )
}
