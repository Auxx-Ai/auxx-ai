// apps/web/src/components/workflow/nodes/core/wait/panel.tsx

'use client'

import { WAIT_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Trash } from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { waitDefinition } from './schema'
import { DurationUnit, type WaitNodeData, WaitType } from './types'

interface WaitNodePanelProps {
  nodeId: string
  data?: WaitNodeData
}

/**
 * Configuration panel for the Wait node
 */
const WaitNodePanelComponent: React.FC<WaitNodePanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  const { inputs, setInputs } = useNodeCrud<WaitNodeData>(nodeId, data!)

  const handleDurationAmountChange = (value: string, isConstant: boolean) => {
    setInputs({
      ...inputs,
      durationAmount: isConstant ? parseFloat(value) || value : value,
      isDurationConstant: isConstant,
    })
  }

  const handleDurationUnitChange = (value: string) => {
    setInputs({ ...inputs, durationUnit: value as DurationUnit })
  }

  const handleTimeChange = (value: string, isConstant: boolean) => {
    setInputs({ ...inputs, time: value, isTimeConstant: isConstant })
  }

  const handleTimezoneChange = (value: string | undefined) => {
    setInputs({ ...inputs, timezone: value })
  }

  const handleTimezoneDelete = () => {
    setInputs({ ...inputs, timezone: undefined })
  }

  return (
    <BasePanel nodeId={nodeId} data={data!}>
      {/* Wait Type Section */}
      <Section
        title='Wait Type'
        description='Choose how to pause the workflow'
        isRequired
        actions={
          <Select
            value={inputs.waitType}
            onValueChange={(value) => setInputs({ ...inputs, waitType: value as WaitType })}
            disabled={isReadOnly}>
            <SelectTrigger variant='default' size='sm' className='mb-0'>
              <SelectValue>
                {inputs.waitType === WaitType.DURATION
                  ? 'Wait for duration'
                  : inputs.waitType === WaitType.SPECIFIC_TIME
                    ? 'Wait until specific time'
                    : inputs.waitType}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WaitType.DURATION}>
                <div>
                  <div className='font-medium'>Wait for duration</div>
                  <div className='text-xs text-muted-foreground'>
                    Pause for a specific amount of time
                  </div>
                </div>
              </SelectItem>
              <SelectItem value={WaitType.SPECIFIC_TIME}>
                <div>
                  <div className='font-medium'>Wait until specific time</div>
                  <div className='text-xs text-muted-foreground'>
                    Pause until a particular date and time
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        }>
        {/* Duration Configuration */}
        {inputs.waitType === WaitType.DURATION && (
          <Field title='Duration Settings' description='Configure how long to wait' isRequired>
            <VarEditorField>
              {/* Input Date (shared by all operations) */}
              <div className='w-full flex flex-row items-center'>
                <div className='flex-1'>
                  <VarEditor
                    value={String(inputs.durationAmount || '')}
                    nodeId={nodeId}
                    onChange={handleDurationAmountChange}
                    placeholder='Pick variable...'
                    placeholderConstant='Enter Duration...'
                    varType={BaseType.NUMBER}
                    mode={VAR_MODE.PICKER}
                    disabled={isReadOnly}
                    isConstantMode={inputs.isDurationConstant}
                    onConstantModeChange={(isConstant) =>
                      setInputs({ ...inputs, isDurationConstant: isConstant })
                    }
                  />
                </div>
                <Select
                  value={inputs.durationUnit}
                  onValueChange={handleDurationUnitChange}
                  disabled={isReadOnly}>
                  <SelectTrigger variant='transparent' className='w-25' size='sm'>
                    <SelectValue placeholder='Select unit' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DurationUnit.SECONDS}>Seconds</SelectItem>
                    <SelectItem value={DurationUnit.MINUTES}>Minutes</SelectItem>
                    <SelectItem value={DurationUnit.HOURS}>Hours</SelectItem>
                    <SelectItem value={DurationUnit.DAYS}>Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </VarEditorField>
          </Field>
        )}

        {/* Specific Time Configuration */}
        {inputs.waitType === WaitType.SPECIFIC_TIME && (
          <Field title='Time Settings' description='Configure when to resume execution' isRequired>
            <div className='grow rounded-lg bg-primary-100 border flex flex-col'>
              {/* Input Date (shared by all operations) */}
              <div className='ps-2 p-1  w-full gap-2 flex-1'>
                <VarEditor
                  value={String(inputs.time || '')}
                  nodeId={nodeId}
                  onChange={handleTimeChange}
                  placeholder='Pick a date...'
                  placeholderConstant='Enter a date...'
                  mode={VAR_MODE.PICKER}
                  varType={BaseType.DATETIME}
                  disabled={isReadOnly}
                  isConstantMode={inputs.isTimeConstant}
                  onConstantModeChange={(isConstant) =>
                    setInputs({ ...inputs, isTimeConstant: isConstant })
                  }
                />
              </div>
              <div className='p-1 border-t flex flex-row items-center gap-1'>
                <TimeZonePicker
                  selected={inputs.timezone}
                  // onOpenChange={(open) => {}}
                  onChange={handleTimezoneChange}>
                  <Button variant='outline' size='sm' className='flex-1' disabled={isReadOnly}>
                    {!inputs.timezone ? 'Change Timezone' : inputs.timezone}
                  </Button>
                </TimeZonePicker>
                <Button
                  variant='outline'
                  size='icon-sm'
                  className='text-bad-500'
                  onClick={handleTimezoneDelete}
                  disabled={isReadOnly}>
                  <Trash />
                </Button>
              </div>
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              Must be at least {WAIT_CONSTANTS.SPECIFIC_TIME.MIN_FUTURE_MINUTES} minute(s) in the
              future
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              If not specified, the account timezone will be used
            </p>
          </Field>
        )}
      </Section>

      {/* Output Variables */}
      <OutputVariablesDisplay
        outputVariables={waitDefinition.outputVariables?.(inputs, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const WaitNodePanel = memo(WaitNodePanelComponent)
