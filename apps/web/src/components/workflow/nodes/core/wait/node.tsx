// apps/web/src/components/workflow/nodes/core/wait/node.tsx

import { type FC, memo } from 'react'
import { type WaitNode as WaitNodeType, type WaitNodeData, WaitType, DurationUnit } from './types'
import { WAIT_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { NodeTargetHandle, NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'

// WaitNodeData is now defined in types.ts

/**
 * Format duration for display
 */
function formatDuration(amount: number | undefined, unit: DurationUnit | undefined): string {
  if (amount === undefined || unit === undefined) return 'Not configured'
  const unitLabel = amount === 1 ? unit.slice(0, -1) : unit
  return `${amount} ${unitLabel}`
}

/**
 * Format specific time for display
 */
function formatTime(time: string | undefined): string {
  if (!time) return 'Not configured'

  try {
    const date = new Date(time)
    return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return 'Invalid time'
  }
}

/**
 * Get wait method indicator
 */
function getWaitMethod(data: WaitNodeData): 'short' | 'long' | 'unknown' {
  if (data.waitType === WaitType.SPECIFIC_TIME) return 'long'

  if (
    data.waitType === WaitType.DURATION &&
    typeof data.durationAmount === 'number' &&
    data.durationUnit
  ) {
    const ms = getDurationMs(data.durationAmount, data.durationUnit)
    return ms < WAIT_CONSTANTS.EXECUTION.SHORT_DELAY_THRESHOLD_MS ? 'short' : 'long'
  }

  return 'unknown'
}

function getDurationMs(amount: number, unit: DurationUnit): number {
  switch (unit) {
    case DurationUnit.SECONDS:
      return amount * 1000
    case DurationUnit.MINUTES:
      return amount * 60 * 1000
    case DurationUnit.HOURS:
      return amount * 60 * 60 * 1000
    case DurationUnit.DAYS:
      return amount * 24 * 60 * 60 * 1000
  }
}

/**
 * Wait node component
 */
export const WaitNode: FC<WaitNodeType> = memo((props) => {
  const { data, id, selected } = props
  const waitMethod = getWaitMethod(data)

  return (
    <BaseNode {...props} width={244} height="auto">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />

      <div className="relative px-3 py-2">
        {/* Wait Type Display */}
        <div className="mb-2">
          <div className="text-xs text-primary-300">
            {data.waitType === WaitType.DURATION ? 'Wait for' : 'Wait until'}
          </div>
          <div className="text-sm font-medium">
            {data.waitType === WaitType.DURATION ? (
              data.isDurationConstant ? (
                formatDuration(data.durationAmount as number, data.durationUnit)
              ) : data.durationAmount ? (
                <div className="relative flex flex-row items-center gap-1">
                  <VariableTag variableId={data.durationAmount as string} nodeId={id} />
                  <span>{data.durationUnit}</span>
                </div>
              ) : (
                'Not configured'
              )
            ) : data.isTimeConstant ? (
              formatTime(data.time)
            ) : data.time ? (
              <VariableTag variableId={data.time as string} nodeId={id} />
            ) : (
              'Not configured'
            )}
          </div>
        </div>

        {/* Wait Method Indicator */}
        <div className="flex items-center gap-1 text-xs">
          <div
            className={`h-2 w-2 rounded-full ${
              waitMethod === 'short'
                ? 'bg-green-500'
                : waitMethod === 'long'
                  ? 'bg-blue-500'
                  : 'bg-gray-400'
            }`}
          />
          <span className="text-muted-foreground">
            {waitMethod === 'short' ? 'Immediate' : waitMethod === 'long' ? 'Queued' : 'Variable'}
          </span>
        </div>

        <NodeSourceHandle
          id={id}
          data={{ ...data, selected }}
          handleId="source"
          handleClassName="!top-1/2 !-right-[0px]"
        />
      </div>
    </BaseNode>
  )
})
