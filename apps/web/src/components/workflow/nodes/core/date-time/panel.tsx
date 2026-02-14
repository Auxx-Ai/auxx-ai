// apps/web/src/components/workflow/nodes/core/date-time/panel.tsx

'use client'

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { produce } from 'immer'
import { memo, useCallback, useMemo } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { BaseType, type UnifiedVariable, VAR_MODE } from '~/components/workflow/types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import {
  ACTION_OPTIONS,
  DATE_FORMAT_OPTIONS,
  DEFAULT_DURATION,
  DEFAULT_FORMAT_TYPE,
  DEFAULT_PARSE_FORMAT_TYPE,
  OPERATION_OPTIONS,
  PARSE_DATE_FORMAT_OPTIONS,
  ROUND_DIRECTION_OPTIONS,
  TIME_UNIT_OPTIONS,
} from './constants'
import { dateTimeNodeDefinition } from './schema'
import {
  DateFormatType,
  type DateTimeNodeData,
  DateTimeOperation,
  ParseDateFormatType,
  TimeUnit,
} from './types'

interface DateTimePanelProps {
  nodeId: string
  data?: DateTimeNodeData
}

/**
 * Date Time node nodeDatauration panel
 */
const DateTimePanelComponent = ({ nodeId, data }: DateTimePanelProps) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs } = useNodeCrud<DateTimeNodeData>(nodeId, data!)

  // Memoized allowed types for date variables
  const allowedDateTypes = useMemo(() => [BaseType.DATE, BaseType.DATETIME], [])
  // Handle operation change with initialization
  const handleOperationChange = (newOperation: DateTimeOperation) => {
    const newData = produce(nodeData, (draft) => {
      draft.operation = newOperation

      // Initialize operation-specific nodeData when switching
      switch (newOperation) {
        case DateTimeOperation.ADD_SUBTRACT:
          draft.addSubtract = { action: 'add', duration: DEFAULT_DURATION, unit: TimeUnit.DAYS }
          break
        case DateTimeOperation.FORMAT:
          draft.format = { type: DEFAULT_FORMAT_TYPE }
          break
        case DateTimeOperation.TIME_BETWEEN:
          draft.timeBetween = { unit: TimeUnit.DAYS }
          break
        case DateTimeOperation.ROUND:
          draft.round = { direction: 'nearest', unit: TimeUnit.DAYS }
          break
        case DateTimeOperation.PARSE_DATE:
          draft.parseDate = { formatType: DEFAULT_PARSE_FORMAT_TYPE }
          break
      }
    })
    setInputs(newData)
  }

  const handleDateVariableSelect = useCallback(
    (value: string, isConstant: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.inputDate = value
        draft.isInputDateConstant = isConstant
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  const handleEndDateVariableSelect = useCallback(
    (value: string, isConstant: boolean) => {
      const newData = produce(nodeData, (draft) => {
        if (draft.timeBetween) {
          draft.timeBetween.endDate = value
          draft.timeBetween.isEndDateConstant = isConstant
        }
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Operation Selection Section */}
      <Section
        title='Operation'
        description='Select the date/time operation to perform.'
        actions={
          <Select value={nodeData.operation} onValueChange={handleOperationChange}>
            <SelectTrigger variant='ghost' size='xs' disabled={isReadOnly}>
              <SelectValue>
                {OPERATION_OPTIONS.find((option) => option.value === nodeData.operation)?.label ||
                  nodeData.operation}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPERATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div>
                    <div className='font-medium'>{option.label}</div>
                    {option.description && (
                      <div className='text-xs text-muted-foreground'>{option.description}</div>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        isRequired>
        <VarEditorField className='p-0'>
          {/* <div className="grow rounded-lg bg-primary-100 border flex flex-col"> */}
          {/* Input Date (shared by all operations) */}
          <div className='flex items-center gap-1 p-1'>
            {/* <VarEditorField> */}
            <VarEditor
              value={nodeData.inputDate || ''}
              onChange={handleDateVariableSelect}
              nodeId={nodeId}
              mode={VAR_MODE.PICKER}
              varType={
                nodeData.operation === DateTimeOperation.PARSE_DATE
                  ? [BaseType.STRING]
                  : [BaseType.DATE, BaseType.DATETIME]
              }
              className=''
              placeholder={
                nodeData.operation === DateTimeOperation.TIME_BETWEEN
                  ? 'Start date'
                  : nodeData.operation === DateTimeOperation.PARSE_DATE
                    ? 'Date string'
                    : 'Input date'
              }
              isConstantMode={nodeData.isInputDateConstant}
              onConstantModeChange={(isConstant) => {
                const newData = produce(nodeData, (draft) => {
                  draft.isInputDateConstant = isConstant
                })
                setInputs(newData)
              }}
              disabled={isReadOnly}
            />

            {/* <VariableInput
              variableId={nodeData.inputDate || ''}
              onVariableSelect={handleDateVariableSelect}
              nodeId={nodeId}
              className="h-6 text-xs mr-1"
              placeholder={
                nodeData.operation === DateTimeOperation.TIME_BETWEEN ? 'Start date' : 'Input date'
              }
              // popoverWidth={400}
              // popoverHeight={500}
              allowedTypes={allowedDateTypes}
            /> */}
            {nodeData.operation === DateTimeOperation.TIME_BETWEEN && nodeData?.timeBetween && (
              <VarEditor
                value={nodeData.timeBetween.endDate || ''}
                onChange={handleEndDateVariableSelect}
                nodeId={nodeId}
                mode={VAR_MODE.PICKER}
                varType={[BaseType.DATE, BaseType.DATETIME]}
                className=''
                placeholder='End date'
                isConstantMode={nodeData.timeBetween.isEndDateConstant}
                onConstantModeChange={(isConstant) => {
                  const newData = produce(nodeData, (draft) => {
                    if (draft.timeBetween) {
                      draft.timeBetween.isEndDateConstant = isConstant
                    }
                  })
                  setInputs(newData)
                }}
                disabled={isReadOnly}
              />
            )}
            {nodeData.operation === DateTimeOperation.FORMAT && data?.format && (
              <div>
                <Select
                  value={nodeData.format.type}
                  onValueChange={(value: DateFormatType) => {
                    const newData = produce(data, (draft) => {
                      if (draft.format) {
                        draft.format.type = value
                      }
                    })
                    setInputs(newData)
                  }}>
                  <SelectTrigger
                    variant='outline'
                    size='sm'
                    disabled={isReadOnly}
                    className='rounded-xl'>
                    <SelectValue>
                      {DATE_FORMAT_OPTIONS.find((option) => option.value === nodeData.format?.type)
                        ?.label || nodeData.format?.type}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div>
                          <div className='font-medium'>{option.label}</div>
                          {option.description && (
                            <div className='text-xs text-muted-foreground'>
                              {option.description}
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {nodeData.operation === DateTimeOperation.PARSE_DATE && data?.parseDate && (
              <div>
                <Select
                  value={nodeData.parseDate.formatType}
                  onValueChange={(value: ParseDateFormatType) => {
                    const newData = produce(data, (draft) => {
                      if (draft.parseDate) {
                        draft.parseDate.formatType = value
                      }
                    })
                    setInputs(newData)
                  }}>
                  <SelectTrigger
                    variant='outline'
                    size='sm'
                    disabled={isReadOnly}
                    className='rounded-xl'>
                    <SelectValue>
                      {PARSE_DATE_FORMAT_OPTIONS.find(
                        (option) => option.value === nodeData.parseDate?.formatType
                      )?.label || nodeData.parseDate?.formatType}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PARSE_DATE_FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div>
                          <div className='font-medium'>{option.label}</div>
                          {option.description && (
                            <div className='text-xs text-muted-foreground'>
                              {option.description}
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* </VarEditorField> */}
          </div>

          {/* Add/Subtract Operation */}
          {nodeData.operation === DateTimeOperation.ADD_SUBTRACT && data?.addSubtract && (
            <div className='border-t p-1'>
              <div className='flex items-center gap-2'>
                {/* Action Selector */}
                <Select
                  value={nodeData.addSubtract?.action}
                  onValueChange={(value: 'add' | 'subtract') => {
                    const newData = produce(data, (draft) => {
                      if (draft.addSubtract) {
                        draft.addSubtract.action = value
                      }
                    })
                    setInputs(newData)
                  }}>
                  <SelectTrigger
                    variant='transparent'
                    disabled={isReadOnly}
                    className='w-[120px] px-2 h-6 text-sm font-medium'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Duration Input */}
                <Input
                  type='number'
                  value={nodeData.addSubtract?.duration || ''}
                  onChange={(e) => {
                    const newData = produce(data, (draft) => {
                      if (draft.addSubtract) {
                        draft.addSubtract.duration = parseInt(e.target.value) || 0
                      }
                    })
                    setInputs(newData)
                  }}
                  min={0}
                  className='w-[100px] h-6'
                  disabled={isReadOnly}
                />

                {/* Time Unit Selector */}
                <Select
                  value={nodeData.addSubtract?.unit}
                  onValueChange={(value: TimeUnit) => {
                    const newData = produce(data, (draft) => {
                      if (draft.addSubtract) {
                        draft.addSubtract.unit = value
                      }
                    })
                    setInputs(newData)
                  }}>
                  <SelectTrigger
                    variant='transparent'
                    className='px-2 h-6 text-sm font-medium'
                    disabled={isReadOnly}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_UNIT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Format Operation */}
          {nodeData.operation === DateTimeOperation.FORMAT &&
            data?.format &&
            nodeData.format?.type === DateFormatType.CUSTOM && (
              <div className='border-t p-1 px-2'>
                <Input
                  id='custom-format'
                  className='h-6.5 '
                  variant='transparent'
                  value={nodeData.format?.customFormat || ''}
                  onChange={(e) => {
                    const newData = produce(data, (draft) => {
                      if (draft.format) {
                        draft.format.customFormat = e.target.value
                      }
                    })
                    setInputs(newData)
                  }}
                  placeholder='e.g., YYYY-MM-DD HH:mm:ss'
                  disabled={isReadOnly}
                />
                {/* <p className="text-xs text-muted-foreground mt-1 ps-1">
                  Use date-fns format tokens (YYYY, MM, DD, HH, mm, ss, etc.)
                </p> */}
              </div>
            )}

          {/* Parse Date Operation - Custom Format */}
          {nodeData.operation === DateTimeOperation.PARSE_DATE &&
            data?.parseDate &&
            nodeData.parseDate?.formatType === ParseDateFormatType.CUSTOM && (
              <div className='border-t p-1 px-2'>
                <Input
                  id='custom-parse-format'
                  className='h-6.5'
                  variant='transparent'
                  value={nodeData.parseDate?.customFormat || ''}
                  onChange={(e) => {
                    const newData = produce(data, (draft) => {
                      if (draft.parseDate) {
                        draft.parseDate.customFormat = e.target.value
                      }
                    })
                    setInputs(newData)
                  }}
                  placeholder='e.g., yyyy-MM-dd HH:mm:ss'
                  disabled={isReadOnly}
                />
                {/* <p className="text-xs text-muted-foreground mt-1 ps-1">
                  Use date-fns format tokens to match your input string
                </p> */}
              </div>
            )}

          {/* Time Between Operation */}
          {nodeData.operation === DateTimeOperation.TIME_BETWEEN && data?.timeBetween && (
            <div className='p-1 border-t'>
              <Select
                value={nodeData.timeBetween?.unit}
                onValueChange={(value: TimeUnit) => {
                  const newData = produce(data, (draft) => {
                    if (draft.timeBetween) {
                      draft.timeBetween.unit = value
                    }
                  })
                  setInputs(newData)
                }}>
                <SelectTrigger
                  variant='transparent'
                  className='px-2 h-6 text-sm font-medium'
                  disabled={isReadOnly}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Round Operation */}
          {nodeData.operation === DateTimeOperation.ROUND && data?.round && (
            <div className='flex items-center gap-2 py-1 border-t px-2'>
              {/* Direction Selector */}
              <Select
                value={nodeData.round?.direction}
                onValueChange={(value: 'up' | 'down' | 'nearest') => {
                  const newData = produce(data, (draft) => {
                    if (draft.round) {
                      draft.round.direction = value
                    }
                  })
                  setInputs(newData)
                }}>
                <SelectTrigger
                  className='w-[140px] px-0 font-medium h-6'
                  variant='transparent'
                  disabled={isReadOnly}>
                  <SelectValue>
                    {ROUND_DIRECTION_OPTIONS.find(
                      (option) => option.value === nodeData.round?.direction
                    )?.label || nodeData.round?.direction}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROUND_DIRECTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className='text-sm text-muted-foreground font-medium'>to</span>

              {/* Time Unit Selector */}
              <Select
                value={nodeData.round?.unit}
                onValueChange={(value: TimeUnit) => {
                  const newData = produce(data, (draft) => {
                    if (draft.round) {
                      draft.round.unit = value
                    }
                  })
                  setInputs(newData)
                }}>
                <SelectTrigger
                  className='flex-1 px-0 font-medium h-6'
                  variant='transparent'
                  disabled={isReadOnly}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </VarEditorField>
      </Section>
      {/* Advanced Settings Section */}
      <Section
        title='Advanced Settings'
        description='Additional nodeDatauration options.'
        initialOpen={false}>
        <div className='space-y-4'>
          <div>
            <Label htmlFor='timezone'>Timezone</Label>
            <Input
              id='timezone'
              value={nodeData.timezone || ''}
              onChange={(e) => setInputs({ ...data, timezone: e.target.value })}
              placeholder='e.g., America/New_York'
              className='mt-1'
              disabled={isReadOnly}
            />
            <p className='text-xs text-muted-foreground mt-1'>
              Leave empty to use user's local timezone
            </p>
          </div>

          {nodeData.operation === DateTimeOperation.FORMAT && (
            <div>
              <Label htmlFor='locale'>Locale</Label>
              <Input
                id='locale'
                value={nodeData.locale || ''}
                onChange={(e) => setInputs({ ...data, locale: e.target.value })}
                placeholder='e.g., en-US'
                className='mt-1'
                disabled={isReadOnly}
              />
              <p className='text-xs text-muted-foreground mt-1'>
                For localized date formatting (month names, etc.)
              </p>
            </div>
          )}
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={dateTimeNodeDefinition.outputVariables(data, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const DateTimePanel = memo(DateTimePanelComponent)
