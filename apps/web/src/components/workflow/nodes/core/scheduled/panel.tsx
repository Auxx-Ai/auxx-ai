// apps/web/src/components/workflow/nodes/core/scheduled-trigger/panel.tsx

'use client'

import React, { useState } from 'react'
import { type ScheduledTriggerNodeData } from './types'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { Label } from '@auxx/ui/components/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Section from '~/components/workflow/ui/section'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { scheduledTriggerDefinition } from './schema'
import { createSchedulePreview } from './utils'
import { IntervalSelector } from './components/interval-selector'
import { CronEditor } from './components/cron-editor'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { produce } from 'immer'
import Field from '~/components/workflow/ui/field'

interface ScheduledTriggerPanelProps {
  nodeId: string
  data: ScheduledTriggerNodeData
}

/**
 * Configuration panel for scheduled trigger node
 */
const ScheduledTriggerPanelComponent: React.FC<ScheduledTriggerPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<ScheduledTriggerNodeData>(
    nodeId,
    data
  )

  // Local state for real-time preview
  const [previewConfig, setPreviewConfig] = useState(nodeData.config)

  // Create schedule preview
  const schedulePreview = createSchedulePreview(previewConfig)

  const handleIntervalChange = (interval: typeof previewConfig.triggerInterval) => {
    const newConfig = produce(previewConfig, (draft) => {
      draft.triggerInterval = interval

      // Clear inappropriate values when switching interval types
      if (interval === 'custom') {
        draft.timeBetweenTriggers = {}
        if (!draft.customCron) {
          draft.customCron = '0 * * * *' // Default: every hour
        }
      } else {
        draft.customCron = undefined
        // Set default value for the selected interval if not set
        if (!draft.timeBetweenTriggers[interval]) {
          draft.timeBetweenTriggers = { [interval]: 1 }
        }
      }
    })

    setPreviewConfig(newConfig)
    setNodeData(
      produce(nodeData, (draft) => {
        draft.config = newConfig
      })
    )
  }

  const handleIntervalValueChange = (value: number | string, isVariable = false) => {
    if (previewConfig.triggerInterval === 'custom') return

    const newConfig = produce(previewConfig, (draft) => {
      draft.timeBetweenTriggers = {
        [previewConfig.triggerInterval]: value,
        isConstant: !isVariable,
      }
    })

    setPreviewConfig(newConfig)
    setNodeData(
      produce(nodeData, (draft) => {
        draft.config = newConfig
      })
    )
  }

  const handleCronExpressionChange = (cronExpression: string) => {
    const newConfig = produce(previewConfig, (draft) => {
      draft.customCron = cronExpression
    })

    setPreviewConfig(newConfig)
    setNodeData(
      produce(nodeData, (draft) => {
        draft.config = newConfig
      })
    )
  }

  const handleTimezoneChange = (timezone: string) => {
    const newConfig = produce(previewConfig, (draft) => {
      draft.timezone = timezone
    })

    setPreviewConfig(newConfig)
    setNodeData(
      produce(nodeData, (draft) => {
        draft.config = newConfig
      })
    )
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Schedule Configuration */}
      <Section
        title="Schedule Configuration"
        description="Configure when this workflow should be triggered."
        isRequired>
        <div className="space-y-4">
          {/* Configuration Tabs */}
          <Tabs
            value={previewConfig.triggerInterval === 'custom' ? 'custom' : 'simple'}
            onValueChange={(value) => {
              if (value === 'custom') {
                handleIntervalChange('custom')
              } else if (previewConfig.triggerInterval === 'custom') {
                // Switch back to simple mode with default hours
                handleIntervalChange('hours')
              }
            }}
            className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="simple">Simple</TabsTrigger>
              <TabsTrigger value="custom">Advanced (Cron)</TabsTrigger>
            </TabsList>

            <TabsContent value="simple" className="mt-4">
              <IntervalSelector
                nodeId={nodeId}
                config={previewConfig}
                onIntervalChange={handleIntervalChange}
                onValueChange={handleIntervalValueChange}
                disabled={isReadOnly}
              />
            </TabsContent>

            <TabsContent value="custom" className="mt-4">
              <CronEditor
                value={previewConfig.customCron || ''}
                onChange={handleCronExpressionChange}
                disabled={isReadOnly}
                config={previewConfig}
              />
            </TabsContent>
          </Tabs>

          {/* Timezone Selection */}
          <Field title="Timezone" description="Select the timezone for the schedule">
            <TimeZonePicker
              open={false}
              onOpenChange={() => {}}
              selected={previewConfig.timezone}
              onChange={handleTimezoneChange}
            />
          </Field>
        </div>
      </Section>

      {/* Schedule Preview */}
      <Section
        title="Schedule Preview"
        description="Preview of when this workflow will be triggered."
        initialOpen={true}>
        <div className="space-y-3">
          {/* Schedule Description */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
            {schedulePreview.isValid ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{schedulePreview.description}</p>
              <p className="text-xs text-muted-foreground">
                Timezone: {previewConfig.timezone || 'System Default'}
              </p>
            </div>
          </div>

          {/* Next Execution Times */}
          {schedulePreview.isValid && schedulePreview.nextExecutions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Next 3 executions:</Label>
              <div className="space-y-1">
                {schedulePreview.nextExecutions.map((date, index) => (
                  <div
                    key={index}
                    className="text-xs text-muted-foreground flex items-center gap-2">
                    <div className="w-1 h-1 bg-muted-foreground rounded-full" />
                    {date.toLocaleString(undefined, {
                      timeZone: previewConfig.timezone,
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZoneName: 'short',
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation Errors */}
          {!schedulePreview.isValid && (
            <div className="text-xs text-destructive">
              Please fix the configuration errors above.
            </div>
          )}
        </div>
      </Section>

      {/* Available Variables */}
      <OutputVariablesDisplay
        outputVariables={scheduledTriggerDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const ScheduledTriggerPanel = React.memo(ScheduledTriggerPanelComponent)
