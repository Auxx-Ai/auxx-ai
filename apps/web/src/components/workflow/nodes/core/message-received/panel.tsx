// apps/web/src/components/workflow/nodes/core/message-received/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { produce } from 'immer'
import { Plus, Trash2 } from 'lucide-react'
import type React from 'react'
import { memo } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { messageReceivedDefinition } from './schema'
import type { MessageReceivedNodeData } from './types'

interface MessageReceivedPanelProps {
  nodeId: string
  data: MessageReceivedNodeData
}

const MessageReceivedPanelComponent: React.FC<MessageReceivedPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<MessageReceivedNodeData>(
    nodeId,
    data
  )

  const addCondition = () => {
    const newData = produce(nodeData, (draft) => {
      if (!draft.message_filter) {
        draft.message_filter = { enabled: true, conditions: [] }
      }
      draft.message_filter.conditions.push({ field: 'subject', operator: 'contains', value: '' })
    })
    setNodeData(newData)
  }

  const removeCondition = (index: number) => {
    const newData = produce(nodeData, (draft) => {
      if (draft.message_filter?.conditions) {
        draft.message_filter.conditions.splice(index, 1)
      }
    })
    setNodeData(newData)
  }

  const updateConditionField = (index: number, field: 'from' | 'subject' | 'body') => {
    const newData = produce(nodeData, (draft) => {
      if (draft.message_filter?.conditions?.[index]) {
        draft.message_filter.conditions[index].field = field
      }
    })
    setNodeData(newData)
  }

  const updateConditionOperator = (index: number, operator: 'contains' | 'equals' | 'regex') => {
    const newData = produce(nodeData, (draft) => {
      if (draft.message_filter?.conditions?.[index]) {
        draft.message_filter.conditions[index].operator = operator
      }
    })
    setNodeData(newData)
  }

  const updateConditionValue = (index: number, value: string) => {
    const newData = produce(nodeData, (draft) => {
      if (draft.message_filter?.conditions?.[index]) {
        draft.message_filter.conditions[index].value = value
      }
    })
    setNodeData(newData)
  }

  const toggleFilterEnabled = (enabled: boolean) => {
    const newData = produce(nodeData, (draft) => {
      if (!draft.message_filter) {
        draft.message_filter = { enabled, conditions: [] }
      } else {
        draft.message_filter.enabled = enabled
      }
    })
    setNodeData(newData)
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section
        title='Message Filters'
        description='Configure filters to control when this trigger activates.'
        showEnable
        onEnableChange={toggleFilterEnabled}
        enabled={nodeData.message_filter?.enabled || false}
        initialOpen={nodeData.message_filter?.enabled || false}>
        <div className='space-y-2'>
          {(nodeData.message_filter?.conditions || []).map((condition, index) => (
            <div key={index} className='flex gap-2 items-center'>
              <Select
                value={condition.field}
                onValueChange={(value: 'from' | 'subject' | 'body') =>
                  updateConditionField(index, value)
                }
                disabled={isReadOnly}>
                <SelectTrigger className='w-24'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='from'>From</SelectItem>
                  <SelectItem value='subject'>Subject</SelectItem>
                  <SelectItem value='body'>Body</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={condition.operator}
                onValueChange={(value: 'contains' | 'equals' | 'regex') =>
                  updateConditionOperator(index, value)
                }
                disabled={isReadOnly}>
                <SelectTrigger className='w-24'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='contains'>Contains</SelectItem>
                  <SelectItem value='equals'>Equals</SelectItem>
                  <SelectItem value='regex'>Regex</SelectItem>
                </SelectContent>
              </Select>

              <Input
                value={condition.value}
                onChange={(e) => updateConditionValue(index, e.target.value)}
                placeholder='Value'
                className='flex-1'
                disabled={isReadOnly}
              />

              <Button
                size='icon'
                variant='ghost'
                onClick={() => removeCondition(index)}
                disabled={isReadOnly}>
                <Trash2 />
              </Button>
            </div>
          ))}

          <Button
            size='sm'
            variant='outline'
            onClick={addCondition}
            className='w-full'
            disabled={isReadOnly}>
            <Plus /> Add Condition
          </Button>
        </div>
      </Section>

      <OutputVariablesDisplay
        outputVariables={messageReceivedDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const MessageReceivedPanel = memo(MessageReceivedPanelComponent)
