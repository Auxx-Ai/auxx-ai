// apps/web/src/components/workflow/nodes/core/list/components/slice-panel.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type React from 'react'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import type { ListNodeData, SliceMode } from '../types'

interface SlicePanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Slice operation configuration panel
 */
export const SlicePanel: React.FC<SlicePanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  const sliceConfig = config.sliceConfig || { mode: 'first', count: 1 }

  const handleModeChange = (mode: SliceMode) => {
    onChange({
      sliceConfig: {
        mode,
        ...(mode === 'first' || mode === 'last' ? { count: 1, isCountConstant: true } : {}),
        ...(mode === 'range'
          ? { start: 0, isStartConstant: true, end: 10, isEndConstant: true }
          : {}),
      },
    })
  }

  const handleCountChange = (value: string, isConstant: boolean) => {
    onChange({
      sliceConfig: {
        ...sliceConfig,
        count: isConstant ? parseInt(value, 10) || value : value,
        isCountConstant: isConstant,
      },
    })
  }

  const handleStartChange = (value: string, isConstant: boolean) => {
    onChange({
      sliceConfig: {
        ...sliceConfig,
        start: isConstant ? parseInt(value, 10) || value : value,
        isStartConstant: isConstant,
      },
    })
  }

  const handleEndChange = (value: string, isConstant: boolean) => {
    onChange({
      sliceConfig: {
        ...sliceConfig,
        end: isConstant ? parseInt(value, 10) || value : value,
        isEndConstant: isConstant,
      },
    })
  }

  return (
    <VarEditorField className='p-0'>
      <div className='flex flex-row gap-1 p-1'>
        {/* Mode Selector */}
        <div>
          <Select value={sliceConfig.mode} onValueChange={handleModeChange} disabled={isReadOnly}>
            <SelectTrigger size='sm' variant='outline'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='first'>First</SelectItem>
              <SelectItem value='last'>Last</SelectItem>
              <SelectItem value='range'>Range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Count input for first/last modes */}
        {(sliceConfig.mode === 'first' || sliceConfig.mode === 'last') && (
          <VarEditor
            placeholder='Count'
            varType={BaseType.NUMBER}
            value={String(sliceConfig.count ?? 1)}
            onChange={handleCountChange}
            nodeId={nodeId}
            mode={VAR_MODE.PICKER}
            isConstantMode={sliceConfig.isCountConstant ?? true}
            onConstantModeChange={(isConstant) =>
              onChange({
                sliceConfig: {
                  ...sliceConfig,
                  isCountConstant: isConstant,
                },
              })
            }
          />
        )}

        {/* Start and End inputs for range mode */}
        {sliceConfig.mode === 'range' && (
          <>
            <VarEditor
              placeholder='Start'
              varType={BaseType.NUMBER}
              value={String(sliceConfig.start ?? 0)}
              onChange={handleStartChange}
              nodeId={nodeId}
              mode={VAR_MODE.PICKER}
              isConstantMode={sliceConfig.isStartConstant ?? true}
              onConstantModeChange={(isConstant) =>
                onChange({
                  sliceConfig: {
                    ...sliceConfig,
                    isStartConstant: isConstant,
                  },
                })
              }
            />
            <VarEditor
              placeholder='End'
              varType={BaseType.NUMBER}
              value={String(sliceConfig.end ?? 10)}
              onChange={handleEndChange}
              nodeId={nodeId}
              mode={VAR_MODE.PICKER}
              isConstantMode={sliceConfig.isEndConstant ?? true}
              onConstantModeChange={(isConstant) =>
                onChange({
                  sliceConfig: {
                    ...sliceConfig,
                    isEndConstant: isConstant,
                  },
                })
              }
            />
          </>
        )}
      </div>
    </VarEditorField>
  )
}
